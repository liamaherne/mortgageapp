import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ExtractInput = z.object({
  fileBase64: z.string().min(10),
  mimeType: z.string().min(3),
});

const SubmitInput = z.object({
  fullName: z.string().trim().min(1).max(200),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  address: z.string().trim().max(500).optional().nullable(),
  extracted: z.object({
    fullName: z.string().nullable(),
    dateOfBirth: z.string().nullable(),
    address: z.string().nullable(),
    confidence: z.object({
      fullName: z.number(),
      dateOfBirth: z.number(),
      address: z.number(),
    }),
  }),
});

export const extractPassport = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ExtractInput.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI service is not configured.");

    const systemPrompt = `You are a passport OCR and document intelligence system. Extract the following fields from the passport document image provided. Return ONLY valid JSON matching this exact schema — no explanation, no code fences:

{
  "fullName": string | null,     // Full name as printed (given names + surname, in natural reading order)
  "dateOfBirth": string | null,  // ISO date YYYY-MM-DD
  "address": string | null,      // Address if visible on the document, else null
  "confidence": {
    "fullName": number,          // 0.0 to 1.0
    "dateOfBirth": number,
    "address": number
  }
}

Guidelines:
- If a field is not visible or unreadable, set the value to null and confidence to 0.
- Confidence should reflect how certain you are the value is correct AND fully legible.
- Passports usually do NOT contain an address — return null with confidence 0 in that case.
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
              { type: "text", text: "Extract passport fields from this document." },
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
      fullName: string | null;
      dateOfBirth: string | null;
      address: string | null;
      confidence: { fullName: number; dateOfBirth: number; address: number };
    };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Extraction failed. The document may be unreadable — please enter details manually.");
    }

    return {
      fullName: parsed.fullName ?? null,
      dateOfBirth: parsed.dateOfBirth ?? null,
      address: parsed.address ?? null,
      confidence: {
        fullName: Number(parsed.confidence?.fullName ?? 0),
        dateOfBirth: Number(parsed.confidence?.dateOfBirth ?? 0),
        address: Number(parsed.confidence?.address ?? 0),
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
    ];

    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .insert({
        full_name: data.fullName,
        date_of_birth: data.dateOfBirth,
        address: data.address ?? null,
        extracted_data: data.extracted,
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
