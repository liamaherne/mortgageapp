import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ExtractInput = z.object({
  fileBase64: z.string().min(10),
  mimeType: z.string().min(3),
});

const BankExtractInput = z.object({
  fileBase64: z.string().min(10),
  mimeType: z.string().min(3),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const DOC_TYPES = ["passport", "driver_license", "national_id", "unknown"] as const;

const SubmitInput = z.object({
  fullName: z.string().trim().min(1).max(200),
  dateOfBirth: z.string().regex(ISO_DATE, "Date must be YYYY-MM-DD"),
  address: z.string().trim().max(500).optional().nullable(),
  passportExpiry: z.string().regex(ISO_DATE, "Expiry must be YYYY-MM-DD"),
  documentType: z.enum(DOC_TYPES).optional(),
  extracted: z.object({
    fullName: z.string().nullable(),
    dateOfBirth: z.string().nullable(),
    address: z.string().nullable(),
    passportExpiry: z.string().nullable(),
    documentType: z.enum(DOC_TYPES).optional(),
    confidence: z.object({
      fullName: z.number(),
      dateOfBirth: z.number(),
      address: z.number(),
      passportExpiry: z.number(),
      documentType: z.number().optional(),
    }),
  }),
}).refine(
  (v) => new Date(v.passportExpiry) >= new Date(new Date().toISOString().slice(0, 10)),
  { path: ["passportExpiry"], message: "ID document is expired." },
);

export const extractPassport = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ExtractInput.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI service is not configured.");

    const systemPrompt = `You are an ID document OCR and classification system. Analyse the uploaded identity document and return ONLY valid JSON matching this exact schema — no explanation, no code fences:

{
  "documentType": "passport" | "driver_license" | "national_id" | "unknown",
  "fullName": string | null,        // Full name as printed (given names + surname, in natural reading order)
  "dateOfBirth": string | null,     // ISO date YYYY-MM-DD
  "address": string | null,         // Address if visible on the document, else null
  "passportExpiry": string | null,  // Document expiry / "Date of expiry" / "Expiration date", ISO YYYY-MM-DD
  "confidence": {
    "documentType": number,         // 0.0 to 1.0
    "fullName": number,
    "dateOfBirth": number,
    "address": number,
    "passportExpiry": number
  }
}

Guidelines:
- Classify the document as one of: "passport" (booklet-style travel document), "driver_license" (driving licence / permit card), "national_id" (state-issued national identity card / residence permit), or "unknown" if it doesn't match any of these.
- If a field is not visible or unreadable, set the value to null and confidence to 0.
- Confidence should reflect how certain you are the value is correct AND fully legible.
- Passports usually do NOT contain an address — return null with confidence 0 in that case. Driver licences and national ID cards often do.
- The expiry date is labelled "Date of expiry", "Expiration date", "Expires", "Valid until", or similar. Do not confuse it with the date of issue or date of birth.
- Do not invent values. If unsure, mark low confidence.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Classify and extract fields from this identity document." },
              {
                type: "image_url",
                image_url: {
                  url: `data:${data.mimeType};base64,${data.fileBase64}`,
                },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error", response.status, errText);
      if (response.status === 429) throw new Error("Rate limit reached. Please try again in a moment.");
      if (response.status === 402) throw new Error("AI credits exhausted. Please add credits to continue.");
      throw new Error("Failed to analyze document. Please try again.");
    }

    const payload = await response.json();
    const content: string = payload.choices?.[0]?.message?.content ?? "";
    let parsed: {
      documentType?: string | null;
      fullName: string | null;
      dateOfBirth: string | null;
      address: string | null;
      passportExpiry: string | null;
      confidence: {
        documentType?: number;
        fullName: number;
        dateOfBirth: number;
        address: number;
        passportExpiry: number;
      };
    };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Extraction failed. The document may be unreadable — please enter details manually.");
    }

    const rawType = (parsed.documentType ?? "unknown").toString().toLowerCase().replace(/[\s-]/g, "_");
    const documentType = (DOC_TYPES as readonly string[]).includes(rawType)
      ? (rawType as (typeof DOC_TYPES)[number])
      : "unknown";

    return {
      documentType,
      fullName: parsed.fullName ?? null,
      dateOfBirth: parsed.dateOfBirth ?? null,
      address: parsed.address ?? null,
      passportExpiry: parsed.passportExpiry ?? null,
      confidence: {
        documentType: Number(parsed.confidence?.documentType ?? 0),
        fullName: Number(parsed.confidence?.fullName ?? 0),
        dateOfBirth: Number(parsed.confidence?.dateOfBirth ?? 0),
        address: Number(parsed.confidence?.address ?? 0),
        passportExpiry: Number(parsed.confidence?.passportExpiry ?? 0),
      },
    };
  });

export const submitApplication = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SubmitInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = new Date().toISOString();
    const audit = [
      {
        field: "fullName",
        source: data.extracted.fullName === data.fullName ? "extracted" : "edited",
        extractedValue: data.extracted.fullName,
        finalValue: data.fullName,
        confidence: data.extracted.confidence.fullName,
        timestamp: now,
      },
      {
        field: "dateOfBirth",
        source: data.extracted.dateOfBirth === data.dateOfBirth ? "extracted" : "edited",
        extractedValue: data.extracted.dateOfBirth,
        finalValue: data.dateOfBirth,
        confidence: data.extracted.confidence.dateOfBirth,
        timestamp: now,
      },
      {
        field: "address",
        source: (data.extracted.address ?? "") === (data.address ?? "") ? "extracted" : "edited",
        extractedValue: data.extracted.address,
        finalValue: data.address ?? null,
        confidence: data.extracted.confidence.address,
        timestamp: now,
      },
      {
        field: "passportExpiry",
        source:
          data.extracted.passportExpiry === data.passportExpiry ? "extracted" : "edited",
        extractedValue: data.extracted.passportExpiry,
        finalValue: data.passportExpiry,
        confidence: data.extracted.confidence.passportExpiry,
        timestamp: now,
      },
      {
        field: "documentType",
        source:
          (data.extracted.documentType ?? "unknown") === (data.documentType ?? "unknown")
            ? "extracted"
            : "edited",
        extractedValue: data.extracted.documentType ?? null,
        finalValue: data.documentType ?? data.extracted.documentType ?? "unknown",
        confidence: data.extracted.confidence.documentType ?? 0,
        timestamp: now,
      },
    ];

    const extractedWithType = {
      ...data.extracted,
      documentType: data.documentType ?? data.extracted.documentType ?? "unknown",
    };

    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .insert({
        full_name: data.fullName,
        date_of_birth: data.dateOfBirth,
        address: data.address ?? null,
        passport_expiry: data.passportExpiry,
        extracted_data: extractedWithType,
        audit_trail: audit,
      })
      .select("id, submitted_at")
      .single();

    if (error) {
      console.error("Insert error", error);
      throw new Error("Could not save application. Please try again.");
    }

    return { id: row.id, submittedAt: row.submitted_at, audit };
  });

export const extractBankStatement = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => BankExtractInput.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI service is not configured.");

    const systemPrompt = `You are a bank statement OCR system. Analyse the uploaded bank statement and return ONLY valid JSON matching this exact schema — no explanation, no code fences:

{
  "bankName": string | null,             // Full bank name as printed on the statement
  "iban": string | null,                 // IBAN with no spaces, uppercase
  "bic": string | null,                  // BIC/SWIFT code, uppercase
  "accountHolderName": string | null,    // Primary account holder full name
  "accountHolderAddress": string | null, // Account holder's postal address
  "statementDate": string | null,        // Most recent statement period end date or statement date, ISO YYYY-MM-DD
  "confidence": {
    "bankName": number,
    "iban": number,
    "bic": number,
    "accountHolderName": number,
    "accountHolderAddress": number,
    "statementDate": number
  }
}

Guidelines:
- Confidence is 0.0 to 1.0.
- If a field is unreadable or absent, set to null and confidence to 0.
- Strip spaces from IBAN and BIC. IBAN is 15-34 alphanumeric characters starting with a 2-letter country code.
- statementDate is the LATEST date on the statement (period end or statement issue date), not the account open date.
- Do not invent values.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract fields from this bank statement." },
              {
                type: "image_url",
                image_url: { url: `data:${data.mimeType};base64,${data.fileBase64}` },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error", response.status, errText);
      if (response.status === 429) throw new Error("Rate limit reached. Please try again in a moment.");
      if (response.status === 402) throw new Error("AI credits exhausted. Please add credits to continue.");
      throw new Error("Failed to analyze bank statement. Please try again.");
    }

    const payload = await response.json();
    const content: string = payload.choices?.[0]?.message?.content ?? "";
    let parsed: {
      bankName: string | null;
      iban: string | null;
      bic: string | null;
      accountHolderName: string | null;
      accountHolderAddress: string | null;
      statementDate: string | null;
      confidence: Record<string, number>;
    };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Extraction failed. The statement may be unreadable — please enter details manually.");
    }

    const clean = (v: string | null) => (v ? v.replace(/\s+/g, "").toUpperCase() : null);
    return {
      bankName: parsed.bankName ?? null,
      iban: clean(parsed.iban),
      bic: clean(parsed.bic),
      accountHolderName: parsed.accountHolderName ?? null,
      accountHolderAddress: parsed.accountHolderAddress ?? null,
      statementDate: parsed.statementDate ?? null,
      confidence: {
        bankName: Number(parsed.confidence?.bankName ?? 0),
        iban: Number(parsed.confidence?.iban ?? 0),
        bic: Number(parsed.confidence?.bic ?? 0),
        accountHolderName: Number(parsed.confidence?.accountHolderName ?? 0),
        accountHolderAddress: Number(parsed.confidence?.accountHolderAddress ?? 0),
        statementDate: Number(parsed.confidence?.statementDate ?? 0),
      },
    };
  });
