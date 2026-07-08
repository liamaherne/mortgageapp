import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useRef, useState } from "react";
import { Toaster } from "sonner";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Landmark,
  Loader2,
  Sparkles,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";


import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { extractPassport, submitApplication } from "@/lib/passport.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Passport Intake — Back Office" },
      {
        name: "description",
        content:
          "Secure back-office workflow to upload a passport, auto-extract applicant details, and submit a verified application.",
      },
      { property: "og:title", content: "Passport Intake — Back Office" },
      {
        property: "og:description",
        content:
          "Upload a passport, auto-extract Full Name, Date of Birth, and Address, then review and submit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PassportIntakePage,
});

const ACCEPTED = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
const MAX_MB = 10;
const LOW_CONFIDENCE = 0.7;

type Extracted = {
  fullName: string | null;
  dateOfBirth: string | null;
  address: string | null;
  passportExpiry: string | null;
  confidence: {
    fullName: number;
    dateOfBirth: number;
    address: number;
    passportExpiry: number;
  };
};

type FormState = {
  fullName: string;
  dateOfBirth: string;
  address: string;
  passportExpiry: string;
};
type Errors = Partial<Record<keyof FormState, string>>;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function PassportIntakePage() {
  const runExtract = useServerFn(extractPassport);
  const runSubmit = useServerFn(submitApplication);

  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "extracting" | "review" | "extract_failed" | "manual" | "submitting" | "submitted"
  >("idle");
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [form, setForm] = useState<FormState>({
    fullName: "",
    dateOfBirth: "",
    address: "",
    passportExpiry: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [confirmed, setConfirmed] = useState<Record<keyof FormState, boolean>>({
    fullName: false,
    dateOfBirth: false,
    address: false,
    passportExpiry: false,
  });
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const lowConfFields = useMemo(() => {
    if (!extracted) return new Set<keyof FormState>();
    const s = new Set<keyof FormState>();
    if (extracted.confidence.fullName < LOW_CONFIDENCE) s.add("fullName");
    if (extracted.confidence.dateOfBirth < LOW_CONFIDENCE) s.add("dateOfBirth");
    if (extracted.confidence.passportExpiry < LOW_CONFIDENCE) s.add("passportExpiry");
    // Only flag address if extractor claims to have found one with low confidence
    if (extracted.address && extracted.confidence.address < LOW_CONFIDENCE) s.add("address");
    return s;
  }, [extracted]);

  const revokePreview = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const reset = useCallback(() => {
    revokePreview();
    setFile(null);
    setPreviewUrl(null);
    setStatus("idle");
    setExtracted(null);
    setForm({ fullName: "", dateOfBirth: "", address: "", passportExpiry: "" });
    setErrors({});
    setConfirmed({ fullName: false, dateOfBirth: false, address: false, passportExpiry: false });
    setSubmittedId(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [revokePreview]);

  const validateFile = (f: File): string | null => {
    if (!ACCEPTED.includes(f.type)) {
      return "Unsupported file type. Please upload a PDF, JPG, JPEG, or PNG.";
    }
    if (f.size > MAX_MB * 1024 * 1024) return `File exceeds ${MAX_MB}MB limit.`;
    return null;
  };

  const handleFile = async (f: File) => {
    const err = validateFile(f);
    if (err) {
      toast.error(err);
      return;
    }
    revokePreview();
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setStatus("extracting");
    setExtracted(null);
    setConfirmed({ fullName: false, dateOfBirth: false, address: false, passportExpiry: false });

    try {
      const base64 = await fileToBase64(f);
      const result = (await runExtract({
        data: { fileBase64: base64, mimeType: f.type },
      })) as Extracted;

      const anyFound = result.fullName || result.dateOfBirth || result.passportExpiry;
      setExtracted(result);
      setForm({
        fullName: result.fullName ?? "",
        dateOfBirth: result.dateOfBirth ?? "",
        address: result.address ?? "",
        passportExpiry: result.passportExpiry ?? "",
      });
      setStatus(anyFound ? "review" : "extract_failed");
      if (anyFound) toast.success("Passport analyzed. Please review the fields below.");
      else toast.warning("We couldn't extract details automatically. Please enter them manually.");
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Extraction failed.";
      toast.error(msg);
      setExtracted({
        fullName: null,
        dateOfBirth: null,
        address: null,
        passportExpiry: null,
        confidence: { fullName: 0, dateOfBirth: 0, address: 0, passportExpiry: 0 },
      });
      setStatus("extract_failed");
    }
  };

  const validate = (values: FormState): Errors => {
    const errs: Errors = {};
    if (!values.fullName.trim()) errs.fullName = "Full name is required.";
    else if (values.fullName.trim().length > 200) errs.fullName = "Full name is too long.";

    if (!values.dateOfBirth) errs.dateOfBirth = "Date of birth is required.";
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.dateOfBirth))
      errs.dateOfBirth = "Use format YYYY-MM-DD.";
    else {
      const d = new Date(values.dateOfBirth);
      if (Number.isNaN(d.getTime())) errs.dateOfBirth = "Invalid date.";
      else if (d > new Date()) errs.dateOfBirth = "Date of birth cannot be in the future.";
      else if (d < new Date("1900-01-01")) errs.dateOfBirth = "Date of birth is unrealistic.";
    }

    if (values.address && values.address.length > 500)
      errs.address = "Address is too long (max 500 characters).";

    // Passport expiry — required, valid, and NOT expired
    const todayIso = new Date().toISOString().slice(0, 10);
    if (!values.passportExpiry) errs.passportExpiry = "Passport expiry date is required.";
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.passportExpiry))
      errs.passportExpiry = "Use format YYYY-MM-DD.";
    else {
      const exp = new Date(values.passportExpiry);
      if (Number.isNaN(exp.getTime())) errs.passportExpiry = "Invalid date.";
      else if (values.passportExpiry < todayIso)
        errs.passportExpiry = "This passport has expired and cannot be accepted.";
      else if (values.dateOfBirth && values.passportExpiry <= values.dateOfBirth)
        errs.passportExpiry = "Expiry date must be after date of birth.";
    }

    // Confidence gates
    for (const field of Array.from(lowConfFields)) {
      if (!confirmed[field]) {
        errs[field] = errs[field] ?? "Please confirm this low-confidence value.";
      }
    }
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setStatus("submitting");
    try {
      const res = (await runSubmit({
        data: {
          fullName: form.fullName.trim(),
          dateOfBirth: form.dateOfBirth,
          address: form.address.trim() || null,
          passportExpiry: form.passportExpiry,
          extracted: extracted ?? {
            fullName: null,
            dateOfBirth: null,
            address: null,
            passportExpiry: null,
            confidence: { fullName: 0, dateOfBirth: 0, address: 0, passportExpiry: 0 },
          },
        },
      })) as { id: string; submittedAt: string };
      setSubmittedId(res.id);
      setStatus("submitted");
      // Discard the in-memory document as soon as submission is confirmed
      revokePreview();
      setPreviewUrl(null);
      setFile(null);
      toast.success("Application submitted successfully.");
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Submission failed.";
      toast.error(msg);
      setStatus("review");
    }
  };

  const isImage = file?.type.startsWith("image/");
  const isPdf = file?.type === "application/pdf";

  return (
    <div className="min-h-screen bg-muted/30">
      <Toaster richColors position="top-right" />

      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">Passport Intake</h1>
              <p className="text-xs text-muted-foreground">Back-office application workflow</p>
            </div>
          </div>
          <Badge variant="outline" className="gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Secure session
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <MortgageFlowSection />

        <div className="mb-6 mt-12 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Back-office · Passport intake
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {status === "submitted" ? (
          <SubmittedView id={submittedId} onReset={reset} />

        ) : status === "idle" ? (
          <WelcomeCard
            onSelect={() => inputRef.current?.click()}
            onDrop={handleFile}
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <PreviewPanel
              file={file}
              previewUrl={previewUrl}
              isImage={!!isImage}
              isPdf={!!isPdf}
              onReplace={() => inputRef.current?.click()}
            />
            <ReviewPanel
              status={status}
              extracted={extracted}
              form={form}
              setForm={setForm}
              errors={errors}
              lowConfFields={lowConfFields}
              confirmed={confirmed}
              setConfirmed={setConfirmed}
              onSubmit={handleSubmit}
              onReset={reset}
            />
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />

        <footer className="mt-10 border-t pt-6 text-xs text-muted-foreground">
          <p>
            Personal data is processed only for this application and is not retained beyond
            submission. Every field records whether the value was auto-extracted or edited by an
            operator (audit trail).
          </p>
        </footer>
      </main>
    </div>
  );
}

function MortgageFlowSection() {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-[#0b1436] text-white shadow-[0_30px_80px_-30px_rgba(11,20,54,0.45)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(233,196,106,0.22),transparent_55%)]" />
      <div className="relative grid gap-8 p-8 sm:p-12 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:gap-12">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e9c46a]">
            <Sparkles className="h-3 w-3" /> MortgageFlow
          </span>
          <h2 className="mt-5 text-3xl font-semibold leading-[1.05] tracking-tight sm:text-4xl md:text-5xl">
            Your Mortgage Journey
            <br />
            Starts <span className="text-[#e9c46a]">Here.</span>
          </h2>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-white/70">
            Apply in minutes. Upload your documents, answer a few simple questions, and receive a
            personalised mortgage assessment.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to="/mortgage"
              className="inline-flex h-12 items-center justify-center rounded-lg bg-[#e9c46a] px-6 text-sm font-semibold text-[#0b1436] transition-colors hover:bg-[#f0d488]"
            >
              Start My Application
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link
              to="/mortgage"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-white/20 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Learn More
            </Link>
          </div>
        </div>
        <div className="relative">
          <div className="rounded-2xl bg-white p-6 text-[#0b1436] shadow-[0_30px_60px_-30px_rgba(0,0,0,0.5)]">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0b1436]/60">
                Personalised assessment
              </p>
              <span className="rounded-full bg-[#0b1436] px-2 py-0.5 text-[10px] font-semibold text-white">
                Preview
              </span>
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight">€385,000</p>
            <p className="text-sm text-[#0b1436]/60">Estimated maximum borrowing</p>
            <div className="mt-5 space-y-3">
              {[
                { l: "Loan-to-Value", v: "72%", bar: 72, c: "bg-[#0b1436]" },
                { l: "Deposit ready", v: "28%", bar: 28, c: "bg-[#e9c46a]" },
                { l: "Affordability", v: "Strong", bar: 88, c: "bg-emerald-500" },
              ].map((r) => (
                <div key={r.l}>
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-[#0b1436]/70">{r.l}</span>
                    <span>{r.v}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#0b1436]/8">
                    <div className={cn("h-full rounded-full", r.c)} style={{ width: `${r.bar}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-2 rounded-xl bg-[#0b1436]/5 px-3 py-2.5 text-xs text-[#0b1436]/70">
              <Landmark className="h-3.5 w-3.5" /> Regulated, secure, and audit-tracked.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function WelcomeCard({

  onSelect,
  onDrop,
}: {
  onSelect: () => void;
  onDrop: (f: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Upload a passport to begin</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We'll extract Full Name, Date of Birth, and (if present) Address, then let you review
          and correct the values before submission.
        </p>
      </div>
      <Card>
        <CardContent className="p-0">
          <button
            type="button"
            onClick={onSelect}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) onDrop(f);
            }}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-12 text-center transition-colors",
              "hover:border-primary/50 hover:bg-accent/50",
              dragging && "border-primary bg-accent"
            )}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Upload className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium">Click to upload or drag & drop</p>
              <p className="mt-1 text-xs text-muted-foreground">
                PDF, JPG, JPEG, or PNG · Max {MAX_MB}MB
              </p>
            </div>
          </button>
        </CardContent>
      </Card>
      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span>Documents are processed in memory only and not stored on our servers.</span>
      </div>
    </div>
  );
}

function PreviewPanel({
  file,
  previewUrl,
  isImage,
  isPdf,
  onReplace,
}: {
  file: File | null;
  previewUrl: string | null;
  isImage: boolean;
  isPdf: boolean;
  onReplace: () => void;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm font-semibold">Uploaded Passport</CardTitle>
          {file && (
            <p className="mt-1 truncate text-xs text-muted-foreground" title={file.name}>
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onReplace}>
          Replace
        </Button>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="flex h-full min-h-[420px] items-center justify-center overflow-hidden rounded-md border bg-muted/40">
          {previewUrl && isImage && (
            <img
              src={previewUrl}
              alt="Uploaded passport preview"
              className="max-h-[560px] w-full object-contain"
            />
          )}
          {previewUrl && isPdf && (
            <object data={previewUrl} type="application/pdf" className="h-[560px] w-full">
              <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
                <FileText className="h-10 w-10" />
                <p>PDF preview not available in this browser.</p>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  Open PDF in new tab
                </a>
              </div>
            </object>
          )}
          {!previewUrl && (
            <p className="text-sm text-muted-foreground">No document loaded</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewPanel({
  status,
  extracted,
  form,
  setForm,
  errors,
  lowConfFields,
  confirmed,
  setConfirmed,
  onSubmit,
  onReset,
}: {
  status: string;
  extracted: Extracted | null;
  form: FormState;
  setForm: (f: FormState) => void;
  errors: Errors;
  lowConfFields: Set<keyof FormState>;
  confirmed: Record<keyof FormState, boolean>;
  setConfirmed: (c: Record<keyof FormState, boolean>) => void;
  onSubmit: () => void;
  onReset: () => void;
}) {
  const isExtracting = status === "extracting";
  const isManual = status === "extract_failed" || status === "manual";
  const isSubmitting = status === "submitting";

  const setField = (key: keyof FormState, value: string) => {
    setForm({ ...form, [key]: value });
  };
  const setConfirm = (key: keyof FormState, value: boolean) => {
    setConfirmed({ ...confirmed, [key]: value });
  };

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Application Details</CardTitle>
          <Button variant="ghost" size="sm" onClick={onReset} className="text-muted-foreground">
            <X className="mr-1 h-3.5 w-3.5" /> Cancel
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {isExtracting && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed py-10 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p>Extracting passport fields…</p>
          </div>
        )}

        {isManual && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Automatic extraction unavailable</AlertTitle>
            <AlertDescription>
              We couldn't reliably read this document. Please enter the applicant's details manually.
            </AlertDescription>
          </Alert>
        )}

        <fieldset disabled={isExtracting || isSubmitting} className="flex flex-col gap-4">
          <Field
            id="fullName"
            label="Full Name"
            value={form.fullName}
            onChange={(v) => setField("fullName", v)}
            error={errors.fullName}
            confidence={extracted?.confidence.fullName}
            isLowConf={lowConfFields.has("fullName")}
            confirmed={confirmed.fullName}
            onConfirm={(v) => setConfirm("fullName", v)}
            extractedValue={extracted?.fullName}
            placeholder="e.g. Jane A. Doe"
          />
          <Field
            id="dateOfBirth"
            label="Date of Birth"
            type="date"
            value={form.dateOfBirth}
            onChange={(v) => setField("dateOfBirth", v)}
            error={errors.dateOfBirth}
            confidence={extracted?.confidence.dateOfBirth}
            isLowConf={lowConfFields.has("dateOfBirth")}
            confirmed={confirmed.dateOfBirth}
            onConfirm={(v) => setConfirm("dateOfBirth", v)}
            extractedValue={extracted?.dateOfBirth}
          />
          <Field
            id="address"
            label="Address"
            optional
            value={form.address}
            onChange={(v) => setField("address", v)}
            error={errors.address}
            confidence={extracted?.confidence.address}
            isLowConf={lowConfFields.has("address")}
            confirmed={confirmed.address}
            onConfirm={(v) => setConfirm("address", v)}
            extractedValue={extracted?.address}
            placeholder="Not typically present on passports — enter if applicable"
          />
          <Field
            id="passportExpiry"
            label="Passport Expiry Date"
            type="date"
            value={form.passportExpiry}
            onChange={(v) => setField("passportExpiry", v)}
            error={errors.passportExpiry}
            confidence={extracted?.confidence.passportExpiry}
            isLowConf={lowConfFields.has("passportExpiry")}
            confirmed={confirmed.passportExpiry}
            onConfirm={(v) => setConfirm("passportExpiry", v)}
            extractedValue={extracted?.passportExpiry}
          />
        </fieldset>

        <div className="mt-auto flex flex-col gap-2 border-t pt-4">
          <Button onClick={onSubmit} disabled={isExtracting || isSubmitting} size="lg">
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…
              </>
            ) : (
              "Submit Application"
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            By submitting, you confirm the values above are accurate.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  confidence,
  isLowConf,
  confirmed,
  onConfirm,
  extractedValue,
  placeholder,
  type = "text",
  optional = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  confidence?: number;
  isLowConf: boolean;
  confirmed: boolean;
  onConfirm: (v: boolean) => void;
  extractedValue?: string | null;
  placeholder?: string;
  type?: string;
  optional?: boolean;
}) {
  const wasEdited = extractedValue !== undefined && extractedValue !== null && value !== extractedValue;
  const wasExtracted = extractedValue !== undefined && extractedValue !== null && value === extractedValue;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-sm">
          {label}
          {optional && <span className="ml-1 text-xs text-muted-foreground">(optional)</span>}
        </Label>
        <div className="flex items-center gap-2">
          {wasExtracted && (
            <Badge variant="secondary" className="gap-1 text-[10px] font-normal">
              <CheckCircle2 className="h-3 w-3" /> Auto-extracted
            </Badge>
          )}
          {wasEdited && (
            <Badge variant="outline" className="text-[10px] font-normal">
              Edited
            </Badge>
          )}
          {typeof confidence === "number" && confidence > 0 && (
            <span
              className={cn(
                "text-[10px] font-medium",
                confidence >= LOW_CONFIDENCE ? "text-emerald-600" : "text-amber-600"
              )}
            >
              {Math.round(confidence * 100)}% conf.
            </span>
          )}
        </div>
      </div>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          isLowConf && "border-amber-500 focus-visible:ring-amber-500",
          error && "border-destructive focus-visible:ring-destructive"
        )}
      />
      {isLowConf && (
        <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => onConfirm(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Low extraction confidence — please verify this value matches the document and confirm.
          </span>
        </label>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function SubmittedView({ id, onReset }: { id: string | null; onReset: () => void }) {
  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Application submitted</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The applicant record has been saved with a full audit trail of extracted vs. edited
              values.
            </p>
          </div>
          {id && (
            <div className="w-full rounded-md border bg-muted/50 px-4 py-2 text-left">
              <p className="text-xs text-muted-foreground">Reference ID</p>
              <p className="font-mono text-sm">{id}</p>
            </div>
          )}
          <Button onClick={onReset} className="w-full">
            Start a new application
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
