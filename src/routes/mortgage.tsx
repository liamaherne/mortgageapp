import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { extractPassport, submitApplication, extractBankStatement } from "@/lib/passport.functions";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  FileCheck2,
  FileText,
  Home,
  Landmark,
  Mail,
  MapPin,
  Phone,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/mortgage")({
  head: () => ({
    meta: [
      { title: "MortgageFlow — Apply for a Mortgage in Minutes" },
      {
        name: "description",
        content:
          "Premium digital mortgage application. Upload documents, auto-extract details, and submit a professional mortgage assessment in minutes.",
      },
      { property: "og:title", content: "MortgageFlow — Apply for a Mortgage in Minutes" },
      {
        property: "og:description",
        content:
          "A frictionless, premium digital mortgage journey. Apply in under 10 minutes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MortgageFlowPage,
});

// -----------------------------------------------------------------------------
// Types & constants
// -----------------------------------------------------------------------------

type Purpose = "purchase" | "remortgage" | "buy-to-let" | "transfer-of-equity";
type ApplicantType = "single" | "joint";
type PropertyType = "house" | "flat" | "new-build" | "buy-to-let" | "other";
type Employment = "employed" | "self-employed" | "contractor" | "retired" | "other";
type CreditItem = "bankruptcy" | "iva" | "ccj" | "missed-payments" | "none";

type FormData = {
  // Step 1
  purpose: Purpose | "";
  applicantType: ApplicantType | "";
  propertyValue: string;
  loanAmount: string;
  deposit: string;
  // Step 2
  propertyType: PropertyType | "";
  ownsOtherProperties: "yes" | "no" | "";
  otherPropertiesCount: string;
  otherPropertiesValue: string;
  // Step 3
  employment: Employment | "";
  bankStatements: { name: string; size: number }[];
  // Step 4
  creditHistory: CreditItem[];
  // Step 5
  ukResident: "yes" | "no" | "";
  // Step 6
  mobile: string;
  email: string;
  marketingOptIn: boolean;
  // Step 7
  agreed: boolean;
};

const EMPTY: FormData = {
  purpose: "",
  applicantType: "",
  propertyValue: "",
  loanAmount: "",
  deposit: "",
  propertyType: "",
  ownsOtherProperties: "",
  otherPropertiesCount: "",
  otherPropertiesValue: "",
  employment: "",
  bankStatements: [],
  creditHistory: [],
  ukResident: "",
  mobile: "",
  email: "",
  marketingOptIn: false,
  agreed: false,
};

const STEPS = [
  { id: 1, label: "Mortgage", icon: Landmark },
  { id: 2, label: "Property", icon: Home },
  { id: 3, label: "Income", icon: CreditCard },
  { id: 4, label: "Credit", icon: FileCheck2 },
  { id: 5, label: "Residency", icon: MapPin },
  { id: 6, label: "Contact", icon: Phone },
  { id: 7, label: "Review", icon: CheckCircle2 },
  { id: 8, label: "Passport", icon: ShieldCheck },
  { id: 9, label: "Bank statement", icon: Building2 },
] as const;

const STORAGE_KEY = "mortgageflow_draft_v1";

type PassportSummary = {
  documentType: "passport" | "driver_license" | "national_id" | "unknown";
  fullName: string;
  dateOfBirth: string;
  address: string | null;
  passportExpiry: string;
  extractedConfidence: {
    documentType: number;
    fullName: number;
    dateOfBirth: number;
    address: number;
    passportExpiry: number;
  };
  fileName: string | null;
};

type BankSummary = {
  bankName: string;
  iban: string;
  bic: string;
  accountHolderName: string;
  accountHolderAddress: string;
  statementDate: string;
  derivedCountry: string | null;
  derivedBBAN: string | null;
  derivedAccountNumber: string | null;
  ibanValid: boolean;
  freshnessLabel: string;
  fileName: string | null;
};


// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

function MortgageFlowPage() {
  const [screen, setScreen] = useState<"landing" | "flow" | "success">("landing");
  const [step, setStep] = useState(1);
  const [data, setData] = useState<FormData>(EMPTY);
  const [reference, setReference] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [passportData, setPassportData] = useState<PassportSummary | null>(null);
  const [bankData, setBankData] = useState<BankSummary | null>(null);


  // Hydrate saved draft
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.data) setData({ ...EMPTY, ...parsed.data });
        if (parsed?.step) setStep(parsed.step);
      }
    } catch {}
  }, []);

  const update = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setData((d) => ({ ...d, [key]: value }));
  };

  const saveDraft = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ data, step }));
      toast.success("Progress saved. You can continue later on this device.");
    } catch {
      toast.error("Could not save progress in this browser.");
    }
  };

  const clearDraft = () => {
    localStorage.removeItem(STORAGE_KEY);
  };

  const ltv = useMemo(() => {
    const price = Number(data.propertyValue);
    const loan = Number(data.loanAmount);
    if (!price || !loan || price <= 0) return 0;
    return Math.round((loan / price) * 1000) / 10;
  }, [data.propertyValue, data.loanAmount]);

  const depositPct = useMemo(() => {
    const price = Number(data.propertyValue);
    const dep = Number(data.deposit);
    if (!price || !dep || price <= 0) return 0;
    return Math.round((dep / price) * 1000) / 10;
  }, [data.propertyValue, data.deposit]);

  const submit = () => {
    const ref = "MF-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    setReference(ref);
    setSubmittedAt(new Date().toLocaleString());
    clearDraft();
    setScreen("success");
  };

  if (screen === "landing") {
    return (
      <LandingScreen
        onStart={() => {
          setScreen("flow");
        }}
        hasDraft={typeof window !== "undefined" && !!localStorage.getItem(STORAGE_KEY)}
      />
    );
  }

  if (screen === "success") {
    return (
      <SuccessScreen
        reference={reference!}
        submittedAt={submittedAt!}
        data={data}
        ltv={ltv}
        depositPct={depositPct}
        passport={passportData}
        bank={bankData}
      />
    );
  }


  return (
    <PageShell>
      <Toaster richColors position="top-right" />
      <FlowHeader step={step} onSave={saveDraft} />
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6">
        <ProgressRail step={step} />

        <div className="mt-8 rounded-3xl bg-white p-5 shadow-[0_20px_60px_-20px_rgba(11,20,54,0.25)] ring-1 ring-[#0b1436]/5 sm:p-10">
          {step === 1 && (
            <StepMortgage
              data={data}
              update={update}
              ltv={ltv}
              depositPct={depositPct}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <StepProperty
              data={data}
              update={update}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <StepEmployment
              data={data}
              update={update}
              onBack={() => setStep(2)}
              onNext={() => setStep(4)}
            />
          )}
          {step === 4 && (
            <StepCredit
              data={data}
              update={update}
              onBack={() => setStep(3)}
              onNext={() => setStep(5)}
            />
          )}
          {step === 5 && (
            <StepResidency
              data={data}
              update={update}
              onBack={() => setStep(4)}
              onNext={() => setStep(6)}
            />
          )}
          {step === 6 && (
            <StepContact
              data={data}
              update={update}
              onBack={() => setStep(5)}
              onNext={() => setStep(7)}
            />
          )}
          {step === 7 && (
            <StepReview
              data={data}
              ltv={ltv}
              onBack={() => setStep(6)}
              onSubmit={() => setStep(8)}
              update={update}
            />
          )}
          {step === 8 && (
            <StepPassport
              onBack={() => setStep(7)}
              onComplete={(pd) => {
                setPassportData(pd);
                setStep(9);
              }}
            />
          )}
          {step === 9 && (
            <StepBankStatement
              onBack={() => setStep(8)}
              onComplete={(bd) => {
                setBankData(bd);
                submit();
              }}
            />
          )}

        </div>
      </div>
    </PageShell>
  );
}

// -----------------------------------------------------------------------------
// Layout / shell
// -----------------------------------------------------------------------------

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#f6f7fb] text-[#0b1436]">{children}</div>;
}

function BrandMark({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const wrap = variant === "dark" ? "text-[#0b1436]" : "text-white";
  const chip =
    variant === "dark"
      ? "bg-[#0b1436] text-[#e9c46a]"
      : "bg-white/10 text-[#e9c46a] ring-1 ring-white/20";
  return (
    <Link to="/mortgage" className={cn("flex items-center gap-2.5", wrap)}>
      <span className={cn("grid h-9 w-9 place-items-center rounded-xl", chip)}>
        <Landmark className="h-4.5 w-4.5" strokeWidth={2.2} />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight">MortgageFlow</span>
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] opacity-60">
          Premium mortgage journey
        </span>
      </span>
    </Link>
  );
}

function FlowHeader({ step, onSave }: { step: number; onSave: () => void }) {
  return (
    <header className="sticky top-0 z-20 border-b border-[#0b1436]/8 bg-white/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <BrandMark />
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="hidden gap-1.5 border-[#0b1436]/15 text-[#0b1436] sm:inline-flex"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Step {step} of {STEPS.length}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={onSave}
            className="border-[#0b1436]/15 text-[#0b1436] hover:bg-[#0b1436]/5"
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Save & continue later
          </Button>
        </div>
      </div>
    </header>
  );
}

function ProgressRail({ step }: { step: number }) {
  const pct = Math.round(((step - 1) / (STEPS.length - 1)) * 100);
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0b1436]/60">
            Application progress
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
            {STEPS[step - 1].label}
            <span className="ml-2 text-sm font-normal text-[#0b1436]/50">
              Step {step} of {STEPS.length}
            </span>
          </h2>
        </div>
        <span className="text-sm font-semibold text-[#0b1436]/70">{pct}%</span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#0b1436]/8">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#0b1436] via-[#1f2f6f] to-[#e9c46a] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ol className="mt-5 hidden gap-2 md:grid md:grid-cols-10">
        {STEPS.map((s) => {
          const active = s.id === step;
          const done = s.id < step;
          const Icon = s.icon;
          return (
            <li
              key={s.id}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl px-2 py-2.5 text-center text-[11px] font-medium transition-colors",
                active && "bg-[#0b1436] text-white",
                done && !active && "bg-[#e9c46a]/15 text-[#0b1436]",
                !active && !done && "text-[#0b1436]/50",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{s.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Landing screen
// -----------------------------------------------------------------------------

function LandingScreen({ onStart, hasDraft }: { onStart: () => void; hasDraft: boolean }) {
  return (
    <div className="min-h-screen bg-[#0b1436] text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_at_top,rgba(233,196,106,0.18),transparent_60%)]" />
      <header className="relative border-b border-white/10">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <BrandMark variant="light" />
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="hidden text-sm text-white/70 hover:text-white sm:inline-flex"
            >
              Back office
            </Link>
            <Button
              onClick={onStart}
              className="bg-[#e9c46a] text-[#0b1436] hover:bg-[#f0d488]"
            >
              {hasDraft ? "Continue application" : "Start My Application"}
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <section className="relative mx-auto grid w-full max-w-6xl gap-12 px-4 py-16 sm:px-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:py-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e9c46a]">
            <Sparkles className="h-3 w-3" /> Digital mortgage platform
          </span>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            Your Mortgage
            <br />
            Journey Starts <span className="text-[#e9c46a]">Here.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/70">
            Apply in minutes. Upload your documents, answer a few simple questions, and receive
            a personalised mortgage assessment.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              size="lg"
              onClick={onStart}
              className="h-12 bg-[#e9c46a] px-6 text-base font-semibold text-[#0b1436] hover:bg-[#f0d488]"
            >
              {hasDraft ? "Continue application" : "Start My Application"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 border-white/20 bg-transparent px-6 text-base font-semibold text-white hover:bg-white/10 hover:text-white"
              onClick={() =>
                document.getElementById("mortgageflow-features")?.scrollIntoView({ behavior: "smooth" })
              }
            >
              Learn More
            </Button>
          </div>
          <div className="mt-10 grid max-w-md grid-cols-3 gap-6 text-sm text-white/70">
            <Stat n="< 10 min" l="Average time" />
            <Stat n="Bank-grade" l="Encryption" />
            <Stat n="AI-assisted" l="Data entry" />
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-4 rounded-[32px] bg-gradient-to-br from-[#e9c46a]/20 via-transparent to-transparent blur-2xl" />
          <div className="relative rounded-[28px] bg-white p-6 text-[#0b1436] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)]">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0b1436]/60">
                Personalised assessment
              </p>
              <Badge className="bg-[#0b1436] text-white hover:bg-[#0b1436]">Preview</Badge>
            </div>
            <p className="mt-4 text-3xl font-semibold tracking-tight">€385,000</p>
            <p className="text-sm text-[#0b1436]/60">Estimated maximum borrowing</p>
            <div className="mt-6 space-y-3">
              <MiniRow label="Loan-to-Value" value="72%" bar={72} />
              <MiniRow label="Deposit ready" value="28%" bar={28} tone="gold" />
              <MiniRow label="Affordability" value="Strong" bar={88} tone="green" />
            </div>
            <div className="mt-6 flex items-center gap-2 rounded-xl bg-[#0b1436]/5 px-3 py-2.5 text-xs text-[#0b1436]/70">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              Documents processed securely and never retained beyond assessment.
            </div>
          </div>
        </div>
      </section>

      <section
        id="mortgageflow-features"
        className="relative border-t border-white/10 bg-[#0a1230]"
      >
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-16 sm:px-6 md:grid-cols-3">
          <Feature
            icon={Sparkles}
            title="AI-assisted extraction"
            body="Upload your ID and bank statements once — we auto-fill the form and highlight anything you need to confirm."
          />
          <Feature
            icon={ShieldCheck}
            title="Trusted & secure"
            body="Bank-grade transport encryption, minimum data retention, and a full audit trail of every value you accept or edit."
          />
          <Feature
            icon={CheckCircle2}
            title="Save & continue"
            body="Life gets busy. Pause any time — your progress is safely stored so you can pick up where you left off."
          />
        </div>
      </section>
    </div>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div>
      <p className="text-lg font-semibold text-white">{n}</p>
      <p className="text-xs uppercase tracking-[0.14em] text-white/50">{l}</p>
    </div>
  );
}

function MiniRow({
  label,
  value,
  bar,
  tone = "navy",
}: {
  label: string;
  value: string;
  bar: number;
  tone?: "navy" | "gold" | "green";
}) {
  const barColor =
    tone === "gold" ? "bg-[#e9c46a]" : tone === "green" ? "bg-emerald-500" : "bg-[#0b1436]";
  return (
    <div>
      <div className="flex items-center justify-between text-xs font-medium">
        <span className="text-[#0b1436]/70">{label}</span>
        <span>{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#0b1436]/8">
        <div className={cn("h-full rounded-full", barColor)} style={{ width: `${bar}%` }} />
      </div>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e9c46a]/15 text-[#e9c46a]">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-white/65">{body}</p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Reusable step primitives
// -----------------------------------------------------------------------------

function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h3 className="text-xl font-semibold tracking-tight text-[#0b1436] sm:text-2xl">{title}</h3>
      {subtitle && <p className="mt-1.5 text-sm text-[#0b1436]/60">{subtitle}</p>}
    </div>
  );
}

function StepNav({
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled,
  disableBack,
  submitting,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  disableBack?: boolean;
  submitting?: boolean;
}) {
  return (
    <div className="mt-8 flex flex-col-reverse gap-3 border-t border-[#0b1436]/8 pt-6 sm:flex-row sm:items-center sm:justify-between">
      {onBack ? (
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={disableBack}
          className="text-[#0b1436]/70 hover:text-[#0b1436]"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
        </Button>
      ) : (
        <span />
      )}
      <Button
        onClick={onNext}
        disabled={nextDisabled || submitting}
        size="lg"
        className="h-12 bg-[#0b1436] px-6 text-white hover:bg-[#111c4b]"
      >
        {nextLabel}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}

function OptionCard({
  active,
  onClick,
  icon: Icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  desc?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all",
        "border-[#0b1436]/10 bg-white hover:border-[#0b1436]/30 hover:shadow-sm",
        active && "border-[#0b1436] bg-[#0b1436] text-white shadow-lg",
      )}
    >
      {Icon && (
        <span
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
            active ? "bg-white/10 text-[#e9c46a]" : "bg-[#0b1436]/5 text-[#0b1436]",
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-tight">{title}</span>
        {desc && (
          <span
            className={cn(
              "mt-1 block text-xs",
              active ? "text-white/70" : "text-[#0b1436]/55",
            )}
          >
            {desc}
          </span>
        )}
      </span>
      <span
        className={cn(
          "mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border",
          active ? "border-[#e9c46a] bg-[#e9c46a]" : "border-[#0b1436]/20",
        )}
      >
        {active && <CheckCircle2 className="h-3.5 w-3.5 text-[#0b1436]" />}
      </span>
    </button>
  );
}

function MoneyInput({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium text-[#0b1436]">
        {label}
      </Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base font-medium text-[#0b1436]/50">
          €
        </span>
        <Input
          id={id}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder={placeholder}
          className="h-14 rounded-xl border-[#0b1436]/12 pl-9 text-lg font-medium tracking-tight text-[#0b1436] shadow-sm focus-visible:border-[#0b1436] focus-visible:ring-[#0b1436]/20"
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Step 1 — Mortgage details
// -----------------------------------------------------------------------------

function StepMortgage({
  data,
  update,
  ltv,
  depositPct,
  onNext,
}: {
  data: FormData;
  update: <K extends keyof FormData>(k: K, v: FormData[K]) => void;
  ltv: number;
  depositPct: number;
  onNext: () => void;
}) {
  const canContinue =
    data.purpose && data.applicantType && data.propertyValue && data.loanAmount && data.deposit;

  return (
    <div>
      <StepHeader
        title="Tell us about your mortgage"
        subtitle="A few quick details so we can shape your assessment."
      />

      <QuestionBlock label="What is the purpose of your mortgage?">
        <div className="grid gap-3 sm:grid-cols-2">
          <OptionCard
            active={data.purpose === "purchase"}
            onClick={() => update("purpose", "purchase")}
            icon={Home}
            title="First Time Buyer"
            desc="I'm buying a new home."
          />
          <OptionCard
            active={data.purpose === "remortgage"}
            onClick={() => update("purpose", "remortgage")}
            icon={Landmark}
            title="Switcher/ Mover"
            desc="Switching my current mortgage or moving home."
          />
          <OptionCard
            active={data.purpose === "buy-to-let"}
            onClick={() => update("purpose", "buy-to-let")}
            icon={Building2}
            title="Buy-to-Let"
            desc="Investment / rental property."
          />
          <OptionCard
            active={data.purpose === "transfer-of-equity"}
            onClick={() => update("purpose", "transfer-of-equity")}
            icon={Users}
            title="Equity Release"
            desc="Releasing Equity from my home."
          />
        </div>
      </QuestionBlock>

      <QuestionBlock label="Are you applying on your own or jointly?">
        <div className="grid gap-3 sm:grid-cols-2">
          <OptionCard
            active={data.applicantType === "single"}
            onClick={() => update("applicantType", "single")}
            icon={UserRound}
            title="Single Applicant"
          />
          <OptionCard
            active={data.applicantType === "joint"}
            onClick={() => update("applicantType", "joint")}
            icon={Users}
            title="Joint Application"
          />
        </div>
      </QuestionBlock>

      <QuestionBlock label="Your numbers">
        <div className="grid gap-4 sm:grid-cols-3">
          <MoneyInput
            id="price"
            label="Purchase price / property value"
            value={data.propertyValue}
            onChange={(v) => update("propertyValue", v)}
            placeholder="450,000"
          />
          <MoneyInput
            id="loan"
            label="Amount to borrow"
            value={data.loanAmount}
            onChange={(v) => update("loanAmount", v)}
            placeholder="360,000"
          />
          <MoneyInput
            id="dep"
            label="Deposit contributing"
            value={data.deposit}
            onChange={(v) => update("deposit", v)}
            placeholder="90,000"
          />
        </div>

        {(ltv > 0 || depositPct > 0) && (
          <div className="mt-5 grid gap-3 rounded-2xl border border-[#0b1436]/8 bg-gradient-to-br from-[#0b1436] to-[#111c4b] p-5 text-white sm:grid-cols-2">
            <SummaryStat label="Loan-to-Value (LTV)" value={`${ltv}%`} accent={ltv > 90} />
            <SummaryStat label="Deposit percentage" value={`${depositPct}%`} />
          </div>
        )}
      </QuestionBlock>

      <StepNav onNext={onNext} nextDisabled={!canContinue} />
    </div>
  );
}

function QuestionBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <p className="mb-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-[#0b1436]/60">
        {label}
      </p>
      {children}
    </section>
  );
}

function SummaryStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">{label}</p>
      <p
        className={cn(
          "mt-1 text-3xl font-semibold tracking-tight",
          accent ? "text-[#e9c46a]" : "text-white",
        )}
      >
        {value}
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Step 2 — Property
// -----------------------------------------------------------------------------

function StepProperty({
  data,
  update,
  onBack,
  onNext,
}: {
  data: FormData;
  update: <K extends keyof FormData>(k: K, v: FormData[K]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const canContinue =
    data.propertyType &&
    data.ownsOtherProperties &&
    (data.ownsOtherProperties === "no" ||
      (data.otherPropertiesCount && data.otherPropertiesValue));

  return (
    <div>
      <StepHeader
        title="Property information"
        subtitle="What kind of property is this application for?"
      />

      <QuestionBlock label="What type of property is this?">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <OptionCard
            active={data.propertyType === "house"}
            onClick={() => update("propertyType", "house")}
            icon={Home}
            title="House"
          />
          <OptionCard
            active={data.propertyType === "flat"}
            onClick={() => update("propertyType", "flat")}
            icon={Building2}
            title="Flat / Apartment"
          />
          <OptionCard
            active={data.propertyType === "new-build"}
            onClick={() => update("propertyType", "new-build")}
            icon={Sparkles}
            title="New Build"
          />
          <OptionCard
            active={data.propertyType === "buy-to-let"}
            onClick={() => update("propertyType", "buy-to-let")}
            icon={Landmark}
            title="Buy-to-Let Property"
          />
          <OptionCard
            active={data.propertyType === "other"}
            onClick={() => update("propertyType", "other")}
            icon={FileText}
            title="Other"
          />
        </div>
      </QuestionBlock>

      <QuestionBlock label="Do you currently own any other properties?">
        <div className="grid gap-3 sm:grid-cols-2">
          <OptionCard
            active={data.ownsOtherProperties === "yes"}
            onClick={() => update("ownsOtherProperties", "yes")}
            title="Yes"
          />
          <OptionCard
            active={data.ownsOtherProperties === "no"}
            onClick={() => update("ownsOtherProperties", "no")}
            title="No"
          />
        </div>

        {data.ownsOtherProperties === "yes" && (
          <div className="mt-4 grid gap-4 rounded-2xl border border-[#0b1436]/8 bg-[#f6f7fb] p-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Number of properties owned</Label>
              <Input
                inputMode="numeric"
                value={data.otherPropertiesCount}
                onChange={(e) =>
                  update("otherPropertiesCount", e.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder="e.g. 2"
                className="h-12 rounded-xl border-[#0b1436]/12"
              />
            </div>
            <MoneyInput
              id="otherval"
              label="Estimated combined value"
              value={data.otherPropertiesValue}
              onChange={(v) => update("otherPropertiesValue", v)}
              placeholder="500,000"
            />
          </div>
        )}
      </QuestionBlock>

      <StepNav onBack={onBack} onNext={onNext} nextDisabled={!canContinue} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Step 3 — Employment & income
// -----------------------------------------------------------------------------

function StepEmployment({
  data,
  update,
  onBack,
  onNext,
}: {
  data: FormData;
  update: <K extends keyof FormData>(k: K, v: FormData[K]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const canContinue = !!data.employment;

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next = Array.from(files)
      .filter((f) => ["application/pdf", "image/png", "image/jpeg"].includes(f.type))
      .map((f) => ({ name: f.name, size: f.size }));
    if (next.length !== files.length) {
      toast.error("Some files were rejected. Please upload PDF, JPG, or PNG only.");
    }
    if (next.length) {
      update("bankStatements", [...data.bankStatements, ...next]);
      toast.success(`${next.length} file(s) uploaded successfully.`);
    }
  };

  return (
    <div>
      <StepHeader
        title="Employment & income"
        subtitle="Help us understand your affordability."
      />

      <QuestionBlock label="What is your employment status?">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["employed", "Employed"],
              ["self-employed", "Self-Employed"],
              ["contractor", "Contractor"],
              ["retired", "Retired"],
              ["other", "Other"],
            ] as [Employment, string][]
          ).map(([v, label]) => (
            <OptionCard
              key={v}
              active={data.employment === v}
              onClick={() => update("employment", v)}
              title={label}
            />
          ))}
        </div>
      </QuestionBlock>

      <Alert className="mb-6 border-[#e9c46a]/40 bg-[#e9c46a]/10 text-[#0b1436]">
        <Sparkles className="h-4 w-4" />
        <AlertTitle className="font-semibold">Speed things up</AlertTitle>
        <AlertDescription className="text-[#0b1436]/75">
          Income and affordability may be automatically assessed using your uploaded bank
          statements.
        </AlertDescription>
      </Alert>

      <StepNav onBack={onBack} onNext={onNext} nextDisabled={!canContinue} />
    </div>
  );
}

function DropZone({
  onFiles,
  hint,
  multiple,
}: {
  onFiles: (files: FileList | null) => void;
  hint: string;
  multiple?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
          "border-[#0b1436]/15 bg-white hover:border-[#0b1436]/40 hover:bg-[#0b1436]/[0.02]",
          dragging && "border-[#e9c46a] bg-[#e9c46a]/10",
        )}
      >
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#0b1436] text-[#e9c46a]">
          <Upload className="h-5 w-5" />
        </span>
        <span>
          <span className="block text-sm font-semibold text-[#0b1436]">
            Click to upload or drag & drop
          </span>
          <span className="mt-1 block text-xs text-[#0b1436]/55">{hint}</span>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept="application/pdf,image/png,image/jpeg,image/jpg"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
    </>
  );
}

// -----------------------------------------------------------------------------
// Step 4 — Credit
// -----------------------------------------------------------------------------

function StepCredit({
  data,
  update,
  onBack,
  onNext,
}: {
  data: FormData;
  update: <K extends keyof FormData>(k: K, v: FormData[K]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const toggle = (v: CreditItem) => {
    if (v === "none") {
      update("creditHistory", data.creditHistory.includes("none") ? [] : ["none"]);
      return;
    }
    const next = data.creditHistory.filter((x) => x !== "none");
    update(
      "creditHistory",
      next.includes(v) ? next.filter((x) => x !== v) : [...next, v],
    );
  };

  const options: [CreditItem, string, string][] = [
    ["bankruptcy", "Bankruptcy", "Discharged or ongoing"],
    ["iva", "IVA", "Individual Voluntary Arrangement"],
    ["ccj", "CCJ", "County Court Judgement"],
    ["missed-payments", "Missed Payments", "On credit accounts"],
    ["none", "None of the above", "Clean credit history"],
  ];

  return (
    <div>
      <StepHeader
        title="Credit profile"
        subtitle="Have you experienced any of the following in the last 6 years?"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {options.map(([v, title, desc]) => (
          <OptionCard
            key={v}
            active={data.creditHistory.includes(v)}
            onClick={() => toggle(v)}
            title={title}
            desc={desc}
          />
        ))}
      </div>

      <Alert className="mt-6 border-[#0b1436]/10 bg-[#0b1436]/[0.03]">
        <ShieldCheck className="h-4 w-4" />
        <AlertDescription className="text-[#0b1436]/75">
          This information helps us understand your mortgage options and does not automatically
          prevent you from obtaining a mortgage.
        </AlertDescription>
      </Alert>

      <StepNav
        onBack={onBack}
        onNext={onNext}
        nextDisabled={data.creditHistory.length === 0}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Step 5 — Residency
// -----------------------------------------------------------------------------

function StepResidency({
  data,
  update,
  onBack,
  onNext,
}: {
  data: FormData;
  update: <K extends keyof FormData>(k: K, v: FormData[K]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <StepHeader title="Ireland tax residency" subtitle="Confirm your Ireland tax residency status." />

      <QuestionBlock label="Are you an Ireland resident for tax purposes?">
        <div className="grid gap-3 sm:grid-cols-2">
          <OptionCard
            active={data.ukResident === "yes"}
            onClick={() => update("ukResident", "yes")}
            title="Yes"
          />
          <OptionCard
            active={data.ukResident === "no"}
            onClick={() => update("ukResident", "no")}
            title="No"
          />
        </div>

        {data.ukResident === "no" && (
          <Alert className="mt-4 border-[#e9c46a]/40 bg-[#e9c46a]/10">
            <AlertTitle className="text-[#0b1436]">Just so you know</AlertTitle>
            <AlertDescription className="text-[#0b1436]/75">
              Additional documentation may be required during underwriting.
            </AlertDescription>
          </Alert>
        )}
      </QuestionBlock>

      <StepNav onBack={onBack} onNext={onNext} nextDisabled={!data.ukResident} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Step 6 — Contact
// -----------------------------------------------------------------------------

function StepContact({
  data,
  update,
  onBack,
  onNext,
}: {
  data: FormData;
  update: <K extends keyof FormData>(k: K, v: FormData[K]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email);
  const mobileValid = /^(?:\+?353|0)8\d{8}$/.test(data.mobile.replace(/\s/g, ""));
  const canContinue = emailValid && mobileValid;

  return (
    <div>
      <StepHeader title="How can we contact you?" subtitle="We'll use these details to keep you updated." />

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="mobile" className="text-sm font-medium">
            Mobile number
          </Label>
          <div className="relative">
            <Phone className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0b1436]/40" />
            <Input
              id="mobile"
              value={data.mobile}
              onChange={(e) => update("mobile", e.target.value)}
              placeholder="087 123 4567"
              className={cn(
                "h-14 rounded-xl border-[#0b1436]/12 pl-11 text-base",
                data.mobile && !mobileValid && "border-red-400 focus-visible:ring-red-400/20",
              )}
            />
          </div>
          {data.mobile && !mobileValid && (
            <p className="text-xs text-red-600">Enter a valid Ireland mobile number.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium">
            Email address
          </Label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0b1436]/40" />
            <Input
              id="email"
              type="email"
              value={data.email}
              onChange={(e) => update("email", e.target.value)}
              placeholder="you@example.com"
              className={cn(
                "h-14 rounded-xl border-[#0b1436]/12 pl-11 text-base",
                data.email && !emailValid && "border-red-400 focus-visible:ring-red-400/20",
              )}
            />
          </div>
          {data.email && !emailValid && (
            <p className="text-xs text-red-600">Enter a valid email address.</p>
          )}
        </div>
      </div>

      <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#0b1436]/10 bg-[#f6f7fb] p-4">
        <Checkbox
          checked={data.marketingOptIn}
          onCheckedChange={(v) => update("marketingOptIn", v === true)}
          className="mt-0.5"
        />
        <span className="text-sm text-[#0b1436]/80">
          I would like to receive updates about mortgage products and services.
        </span>
      </label>

      <StepNav onBack={onBack} onNext={onNext} nextDisabled={!canContinue} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Step 7 — Review
// -----------------------------------------------------------------------------


function StepReview({
  data,
  ltv,
  onBack,
  onSubmit,
  update,
}: {
  data: FormData;
  ltv: number;
  onBack: () => void;
  onSubmit: () => void;
  update: <K extends keyof FormData>(k: K, v: FormData[K]) => void;
}) {
  return (
    <div>
      <StepHeader
        title="Review & submit"
        subtitle="Double-check your details, then submit for assessment."
      />

      <div className="grid gap-4">
        <ReviewCard
          title="Mortgage"
          rows={[
            ["Purpose", labelize(data.purpose)],
            ["Applicants", labelize(data.applicantType)],
            ["Property value", money(data.propertyValue)],
            ["Loan amount", money(data.loanAmount)],
            ["Deposit", money(data.deposit)],
            ["Estimated LTV", `${ltv}%`],
          ]}
        />
        <ReviewCard
          title="Property"
          rows={[
            ["Property type", labelize(data.propertyType)],
            ["Owns other properties", labelize(data.ownsOtherProperties)],
            ...(data.ownsOtherProperties === "yes"
              ? ([
                  ["Number owned", data.otherPropertiesCount || "—"],
                  ["Combined value", money(data.otherPropertiesValue)],
                ] as [string, string][])
              : []),
          ]}
        />
        <ReviewCard
          title="Income & credit"
          rows={[
            ["Employment", labelize(data.employment)],
            ["Bank statements", `${data.bankStatements.length} file(s)`],
            [
              "Credit history",
              data.creditHistory.length
                ? data.creditHistory.map(labelize).join(", ")
                : "—",
            ],
            ["Ireland tax resident", labelize(data.ukResident)],
          ]}
        />
        <ReviewCard
          title="Contact"
          rows={[
            ["Mobile", data.mobile || "—"],
            ["Email", data.email || "—"],
          ]}
        />
      </div>

      <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#0b1436]/10 bg-[#0b1436] p-5 text-white">
        <Checkbox
          checked={data.agreed}
          onCheckedChange={(v) => update("agreed", v === true)}
          className="mt-0.5 border-white/40 data-[state=checked]:border-[#e9c46a] data-[state=checked]:bg-[#e9c46a] data-[state=checked]:text-[#0b1436]"
        />
        <span className="text-sm leading-relaxed text-white/85">
          I confirm that the information provided is accurate to the best of my knowledge and I
          consent to the processing of my personal information for the purposes of assessing my
          mortgage application.
        </span>
      </label>

      <StepNav
        onBack={onBack}
        onNext={onSubmit}
        nextLabel="Continue to passport verification"
        nextDisabled={!data.agreed}
      />
    </div>
  );
}

function ReviewCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-2xl border border-[#0b1436]/10 bg-white p-5">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0b1436]/60">
        {title}
      </p>
      <dl className="grid gap-2 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 border-b border-dashed border-[#0b1436]/8 py-1.5 last:border-0">
            <dt className="text-xs text-[#0b1436]/60">{k}</dt>
            <dd className="text-right text-sm font-medium">{v || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function money(v: string) {
  if (!v) return "—";
  const n = Number(v);
  if (!n) return "—";
  return "€" + n.toLocaleString();
}

function labelize(v: string) {
  if (!v) return "—";
  return v
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

// -----------------------------------------------------------------------------
// Success screen
// -----------------------------------------------------------------------------

function SuccessScreen({
  reference,
  submittedAt,
  data,
  ltv,
}: {
  reference: string;
  submittedAt: string;
  data: FormData;
  ltv: number;
}) {
  const download = () => {
    const summary = {
      reference,
      submittedAt,
      ltv,
      mortgage: {
        purpose: data.purpose,
        applicantType: data.applicantType,
        propertyValue: data.propertyValue,
        loanAmount: data.loanAmount,
        deposit: data.deposit,
      },
      property: {
        type: data.propertyType,
        ownsOthers: data.ownsOtherProperties,
      },
      employment: data.employment,
      credit: data.creditHistory,
      ukResident: data.ukResident,
      contact: { mobile: data.mobile, email: data.email },
    };
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reference}-summary.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#f6f7fb]">
      <header className="border-b border-[#0b1436]/8 bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <BrandMark />
          <Link to="/" className="text-sm text-[#0b1436]/70 hover:text-[#0b1436]">
            Back to home
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <div className="rounded-3xl bg-white p-8 shadow-[0_30px_80px_-30px_rgba(11,20,54,0.25)] ring-1 ring-[#0b1436]/5 sm:p-12">
          <div className="flex flex-col items-center text-center">
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-8 w-8" />
            </span>
            <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
              Application Submitted Successfully
            </h1>
            <p className="mt-3 max-w-md text-[15px] text-[#0b1436]/65">
              Thank you for your application. Our mortgage specialists will review your information
              and contact you shortly regarding the next steps.
            </p>
          </div>

          <div className="mt-8 grid gap-3 rounded-2xl border border-[#0b1436]/10 bg-[#f6f7fb] p-5 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0b1436]/60">
                Reference number
              </p>
              <p className="mt-1 font-mono text-lg font-semibold">{reference}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0b1436]/60">
                Submitted
              </p>
              <p className="mt-1 text-sm">{submittedAt}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button
              onClick={download}
              className="h-12 flex-1 bg-[#0b1436] text-white hover:bg-[#111c4b]"
            >
              Download Application Summary
            </Button>
            <Button
              variant="outline"
              className="h-12 flex-1 border-[#0b1436]/15 text-[#0b1436] hover:bg-[#0b1436]/5"
              onClick={() =>
                (window.location.href =
                  "mailto:support@mortgageflow.example?subject=" + encodeURIComponent(reference))
              }
            >
              Contact Support
            </Button>
          </div>

          <div className="mt-8 flex items-center gap-2 rounded-xl bg-[#e9c46a]/10 px-4 py-3 text-xs text-[#0b1436]/75">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Your uploaded documents were processed for assessment only and are not retained longer
            than necessary.
          </div>
        </div>
      </main>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Step 8 — Passport intake (back-office verification)
// -----------------------------------------------------------------------------

const PASSPORT_ACCEPTED = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
const PASSPORT_MAX_MB = 10;
const PASSPORT_LOW_CONF = 0.7;

type DocumentType = "passport" | "driver_license" | "national_id" | "unknown";

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  passport: "Passport",
  driver_license: "Driver's licence",
  national_id: "National ID",
  unknown: "Unrecognised document",
};

type PassportExtracted = {
  documentType: DocumentType;
  fullName: string | null;
  dateOfBirth: string | null;
  address: string | null;
  passportExpiry: string | null;
  confidence: {
    documentType: number;
    fullName: number;
    dateOfBirth: number;
    address: number;
    passportExpiry: number;
  };
};

type PassportForm = {
  documentType: DocumentType;
  fullName: string;
  dateOfBirth: string;
  address: string;
  passportExpiry: string;
};

function passportFileToBase64(file: File): Promise<string> {
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

type ExpiryStatus = { tone: "expired" | "soon" | "valid" | "unknown"; label: string; days: number | null };

function getExpiryStatus(iso: string): ExpiryStatus {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { tone: "unknown", label: "Not provided", days: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(iso + "T00:00:00");
  const days = Math.round((exp.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { tone: "expired", label: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`, days };
  if (days <= 90) return { tone: "soon", label: `Expires in ${days} day${days === 1 ? "" : "s"}`, days };
  return { tone: "valid", label: `Valid — expires in ${days} days`, days };
}

function StepPassport({
  onBack,
  onComplete,
}: {
  onBack: () => void;
  onComplete: () => void;
}) {
  const runExtract = useServerFn(extractPassport);
  const runSubmit = useServerFn(submitApplication);
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<
    "idle" | "extracting" | "review" | "extract_failed" | "submitting"
  >("idle");
  const [extracted, setExtracted] = useState<PassportExtracted | null>(null);
  const [form, setForm] = useState<PassportForm>({
    documentType: "unknown",
    fullName: "",
    dateOfBirth: "",
    address: "",
    passportExpiry: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof PassportForm, string>>>({});

  const lowConf = useMemo(() => {
    const s = new Set<keyof PassportForm>();
    if (!extracted) return s;
    if (extracted.confidence.fullName < PASSPORT_LOW_CONF) s.add("fullName");
    if (extracted.confidence.dateOfBirth < PASSPORT_LOW_CONF) s.add("dateOfBirth");
    if (extracted.confidence.passportExpiry < PASSPORT_LOW_CONF) s.add("passportExpiry");
    if (extracted.address && extracted.confidence.address < PASSPORT_LOW_CONF) s.add("address");
    return s;
  }, [extracted]);

  const handleFile = async (f: File) => {
    if (!PASSPORT_ACCEPTED.includes(f.type)) {
      toast.error("Unsupported file type. Please upload a PDF, JPG, JPEG, or PNG.");
      return;
    }
    if (f.size > PASSPORT_MAX_MB * 1024 * 1024) {
      toast.error(`File exceeds ${PASSPORT_MAX_MB}MB limit.`);
      return;
    }
    setFile(f);
    setStatus("extracting");
    try {
      const base64 = await passportFileToBase64(f);
      const result = (await runExtract({
        data: { fileBase64: base64, mimeType: f.type },
      })) as PassportExtracted;
      setExtracted(result);
      setForm({
        documentType: result.documentType ?? "unknown",
        fullName: result.fullName ?? "",
        dateOfBirth: result.dateOfBirth ?? "",
        address: result.address ?? "",
        passportExpiry: result.passportExpiry ?? "",
      });
      const anyFound = result.fullName || result.dateOfBirth || result.passportExpiry;
      setStatus(anyFound ? "review" : "extract_failed");
      if (anyFound) toast.success("Passport analysed. Please review the fields.");
      else toast.warning("We couldn't extract details. Please enter them manually.");
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Extraction failed.";
      toast.error(msg);
      setExtracted({
        documentType: "unknown",
        fullName: null,
        dateOfBirth: null,
        address: null,
        passportExpiry: null,
        confidence: { documentType: 0, fullName: 0, dateOfBirth: 0, address: 0, passportExpiry: 0 },
      });
      setStatus("extract_failed");
    }
  };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof PassportForm, string>> = {};
    if (!form.fullName.trim()) errs.fullName = "Full name is required.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth))
      errs.dateOfBirth = "Use format YYYY-MM-DD.";
    else if (new Date(form.dateOfBirth) > new Date())
      errs.dateOfBirth = "Date of birth cannot be in the future.";
    const today = new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.passportExpiry))
      errs.passportExpiry = "Use format YYYY-MM-DD.";
    else if (form.passportExpiry < today)
      errs.passportExpiry = "This ID document has expired and cannot be accepted.";
    else if (form.dateOfBirth && form.passportExpiry <= form.dateOfBirth)
      errs.passportExpiry = "Expiry date must be after date of birth.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submitPassport = async () => {
    if (!extracted) return;
    if (!validate()) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setStatus("submitting");
    try {
      await runSubmit({
        data: {
          fullName: form.fullName.trim(),
          dateOfBirth: form.dateOfBirth,
          address: form.address.trim() || null,
          passportExpiry: form.passportExpiry,
          documentType: form.documentType,
          extracted,
        },
      });
      toast.success("Identity verified. Finalising your application…");
      onComplete();
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Submission failed.";
      toast.error(msg);
      setStatus("review");
    }
  };

  return (
    <div>
      <StepHeader
        title="Identity verification"
        subtitle="Upload your passport, driver's licence, or national ID so we can verify your identity and finalise your application."
      />

      {status === "idle" && (
        <div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            className="flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-[#0b1436]/15 bg-[#f6f7fb] p-10 text-center transition-colors hover:border-[#0b1436]/40 hover:bg-[#0b1436]/5"
          >
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#0b1436] text-[#e9c46a]">
              <Upload className="h-6 w-6" />
            </span>
            <span className="text-base font-semibold text-[#0b1436]">
              Upload ID document
            </span>
            <span className="text-xs text-[#0b1436]/60">
              Passport, driver's licence, or national ID
            </span>
            <span className="text-xs text-[#0b1436]/60">
              PDF, JPG, JPEG or PNG · up to {PASSPORT_MAX_MB}MB
            </span>
          </button>
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-[#e9c46a]/10 px-4 py-3 text-xs text-[#0b1436]/75">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600" />
            Your document is processed for identity verification only and is not retained
            beyond submission.
          </div>
        </div>
      )}

      {status === "extracting" && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#0b1436]/10 bg-white p-10 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#0b1436]/20 border-t-[#0b1436]" />
          <p className="text-sm font-medium text-[#0b1436]">Analysing your document…</p>
          <p className="text-xs text-[#0b1436]/60">This usually takes a few seconds.</p>
        </div>
      )}

      {(status === "review" || status === "extract_failed" || status === "submitting") && (
        <div className="space-y-5">
          {status === "extract_failed" && (
            <Alert className="border-amber-300 bg-amber-50 text-amber-900">
              <AlertTitle>Couldn't read the document automatically</AlertTitle>
              <AlertDescription>
                Please enter your details manually below, or try uploading a clearer image.
              </AlertDescription>
            </Alert>
          )}

          <DocTypeCard
            value={form.documentType}
            onChange={(v) => setForm({ ...form, documentType: v })}
            extractedType={extracted?.documentType ?? "unknown"}
            confidence={extracted?.confidence.documentType ?? 0}
          />

          <ExpiryFlag expiry={form.passportExpiry} />

          <div className="grid gap-4">
            <PassportField
              id="pf-fullName"
              label="Full name"
              value={form.fullName}
              onChange={(v) => setForm({ ...form, fullName: v })}
              error={errors.fullName}
              lowConf={lowConf.has("fullName")}
              extractedValue={extracted?.fullName ?? null}
              confidence={extracted?.confidence.fullName ?? 0}
            />
            <PassportField
              id="pf-dob"
              label="Date of birth"
              type="date"
              value={form.dateOfBirth}
              onChange={(v) => setForm({ ...form, dateOfBirth: v })}
              error={errors.dateOfBirth}
              lowConf={lowConf.has("dateOfBirth")}
              extractedValue={extracted?.dateOfBirth ?? null}
              confidence={extracted?.confidence.dateOfBirth ?? 0}
            />
            <PassportField
              id="pf-expiry"
              label={`${DOC_TYPE_LABELS[form.documentType]} expiry`}
              type="date"
              value={form.passportExpiry}
              onChange={(v) => setForm({ ...form, passportExpiry: v })}
              error={errors.passportExpiry}
              lowConf={lowConf.has("passportExpiry")}
              extractedValue={extracted?.passportExpiry ?? null}
              confidence={extracted?.confidence.passportExpiry ?? 0}
            />
            <PassportField
              id="pf-address"
              label="Address (optional)"
              value={form.address}
              onChange={(v) => setForm({ ...form, address: v })}
              error={errors.address}
              lowConf={lowConf.has("address")}
              extractedValue={extracted?.address ?? null}
              confidence={extracted?.confidence.address ?? 0}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-[#0b1436]/5 px-4 py-3 text-xs text-[#0b1436]/70">
            <span className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5" />
              {file?.name ?? "Manual entry"}
            </span>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="font-semibold text-[#0b1436] hover:underline"
            >
              Replace document
            </button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={PASSPORT_ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />

      <StepNav
        onBack={onBack}
        onNext={submitPassport}
        nextLabel={status === "submitting" ? "Submitting…" : "Continue to bank statement"}
        nextDisabled={status === "idle" || status === "extracting" || status === "submitting"}
        submitting={status === "submitting"}
      />
    </div>
  );
}

function PassportField({
  id,
  label,
  value,
  onChange,
  error,
  lowConf,
  extractedValue,
  confidence,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  lowConf?: boolean;
  extractedValue: string | null;
  confidence: number;
  type?: string;
}) {
  const edited = extractedValue !== null && value !== extractedValue;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-sm font-medium text-[#0b1436]">
          {label}
        </Label>
        <div className="flex items-center gap-1.5">
          {extractedValue !== null && (
            <Badge
              variant="outline"
              className={cn(
                "gap-1 border-[#0b1436]/15 text-[10px] font-semibold uppercase tracking-wider",
                edited ? "text-amber-700" : "text-emerald-700",
              )}
            >
              {edited ? "Edited" : "Auto-extracted"}
              {confidence > 0 && <span className="opacity-60">· {Math.round(confidence * 100)}%</span>}
            </Badge>
          )}
        </div>
      </div>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-12 rounded-xl border-[#0b1436]/12 text-[#0b1436] shadow-sm focus-visible:border-[#0b1436] focus-visible:ring-[#0b1436]/20",
          error && "border-red-400 focus-visible:border-red-500 focus-visible:ring-red-200",
          lowConf && !error && "border-amber-400",
        )}
      />
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : lowConf ? (
        <p className="text-xs text-amber-700">
          Low confidence — please verify this value carefully.
        </p>
      ) : null}
    </div>
  );
}

function DocTypeCard({
  value,
  onChange,
  extractedType,
  confidence,
}: {
  value: DocumentType;
  onChange: (v: DocumentType) => void;
  extractedType: DocumentType;
  confidence: number;
}) {
  const options: DocumentType[] = ["passport", "driver_license", "national_id"];
  const pct = Math.round(confidence * 100);
  return (
    <div className="rounded-2xl border border-[#0b1436]/10 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0b1436]/60">
            Document classification
          </p>
          <p className="text-sm font-semibold text-[#0b1436]">
            Detected: {DOC_TYPE_LABELS[extractedType]}
          </p>
        </div>
        <Badge
          className={cn(
            "border-transparent",
            confidence >= 0.7
              ? "bg-emerald-100 text-emerald-800"
              : confidence > 0
                ? "bg-amber-100 text-amber-800"
                : "bg-[#0b1436]/10 text-[#0b1436]/70",
          )}
        >
          {confidence > 0 ? `${pct}% confidence` : "Unclassified"}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              "rounded-xl border px-3 py-2.5 text-left text-sm transition-colors",
              value === opt
                ? "border-[#0b1436] bg-[#0b1436] text-white"
                : "border-[#0b1436]/15 bg-white text-[#0b1436] hover:border-[#0b1436]/40",
            )}
          >
            <span className="block text-[11px] font-semibold uppercase tracking-wider opacity-70">
              {opt === extractedType ? "AI detected" : "Override"}
            </span>
            <span className="mt-0.5 block font-semibold">{DOC_TYPE_LABELS[opt]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ExpiryFlag({ expiry }: { expiry: string }) {
  const status = getExpiryStatus(expiry);
  const tone =
    status.tone === "expired"
      ? "border-red-300 bg-red-50 text-red-800"
      : status.tone === "soon"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : status.tone === "valid"
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "border-[#0b1436]/15 bg-[#0b1436]/5 text-[#0b1436]/70";
  const label =
    status.tone === "expired"
      ? "Expired"
      : status.tone === "soon"
        ? "Expiring soon"
        : status.tone === "valid"
          ? "Valid"
          : "Unknown";
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-sm", tone)}>
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4" />
        <span className="font-semibold">Expiry status: {label}</span>
        <span className="opacity-80">— {status.label}</span>
      </div>
      <span className="text-xs opacity-70">Compared against today ({today})</span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Step 9 — Bank statement intake
// -----------------------------------------------------------------------------

const BANK_ACCEPTED = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
const BANK_MAX_MB = 10;

type BankExtracted = {
  bankName: string | null;
  iban: string | null;
  bic: string | null;
  accountHolderName: string | null;
  accountHolderAddress: string | null;
  statementDate: string | null;
  confidence: {
    bankName: number;
    iban: number;
    bic: number;
    accountHolderName: number;
    accountHolderAddress: number;
    statementDate: number;
  };
};

type BankForm = {
  bankName: string;
  iban: string;
  bic: string;
  accountHolderName: string;
  accountHolderAddress: string;
  statementDate: string;
};

// Country → { bbanLength, accountNumberFromBBAN(bban) }
// Domestic account number position within the BBAN varies by country.
// For unlisted countries we fall back to the trailing digits of the BBAN.
const IBAN_COUNTRY_ACCOUNT: Record<string, (bban: string) => string> = {
  IE: (b) => b.slice(10, 18),  // 4 bank + 6 sort + 8 account
  GB: (b) => b.slice(10, 18),  // 4 bank + 6 sort + 8 account
  DE: (b) => b.slice(8, 18),   // 8 bank + 10 account
  FR: (b) => b.slice(9, 20),   // 5 bank + 5 branch + 11 account
  ES: (b) => b.slice(12, 22),  // 4 bank + 4 branch + 2 check + 10 account
  NL: (b) => b.slice(4, 14),   // 4 bank + 10 account
  IT: (b) => b.slice(11, 23),  // 1 check + 5 bank + 5 branch + 12 account
  BE: (b) => b.slice(3, 10),   // 3 bank + 7 account
  PT: (b) => b.slice(8, 19),   // 4 bank + 4 branch + 11 account
  AT: (b) => b.slice(5, 16),   // 5 bank + 11 account
  LU: (b) => b.slice(3, 16),   // 3 bank + 13 account
  US: (b) => b,                // Not IBAN natively; passthrough
};

function deriveAccountNumber(iban: string): { country: string; bban: string; account: string } | null {
  const clean = iban.replace(/\s+/g, "").toUpperCase();
  if (clean.length < 15 || clean.length > 34) return null;
  const country = clean.slice(0, 2);
  if (!/^[A-Z]{2}$/.test(country)) return null;
  const bban = clean.slice(4);
  const extractor = IBAN_COUNTRY_ACCOUNT[country];
  const account = extractor ? extractor(bban) : bban.slice(-8);
  return { country, bban, account };
}

// ISO 13616 mod-97 IBAN check
function isValidIban(iban: string): boolean {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s) || s.length < 15 || s.length > 34) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  const converted = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  // Compute mod 97 in chunks (BigInt not needed)
  let remainder = 0;
  for (let i = 0; i < converted.length; i += 7) {
    const chunk = String(remainder) + converted.slice(i, i + 7);
    remainder = Number(chunk) % 97;
  }
  return remainder === 1;
}

type StatementFreshness = { tone: "valid" | "stale" | "future" | "unknown"; label: string; days: number | null };

function getStatementFreshness(iso: string): StatementFreshness {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { tone: "unknown", label: "No statement date detected", days: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(iso + "T00:00:00");
  const days = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (days < 0) return { tone: "future", label: `Dated ${Math.abs(days)} day(s) in the future`, days };
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  if (d < sixMonthsAgo) return { tone: "stale", label: `Older than 6 months (${days} days old)`, days };
  return { tone: "valid", label: `Within the last 6 months (${days} day${days === 1 ? "" : "s"} old)`, days };
}

function StepBankStatement({
  onBack,
  onComplete,
}: {
  onBack: () => void;
  onComplete: () => void;
}) {
  const runExtract = useServerFn(extractBankStatement);
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "extracting" | "review" | "extract_failed">("idle");
  const [extracted, setExtracted] = useState<BankExtracted | null>(null);
  const [form, setForm] = useState<BankForm>({
    bankName: "",
    iban: "",
    bic: "",
    accountHolderName: "",
    accountHolderAddress: "",
    statementDate: "",
  });

  const readFileAsBase64 = (f: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(((reader.result as string) ?? "").split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.readAsDataURL(f);
    });

  const handleFile = async (f: File) => {
    if (!BANK_ACCEPTED.includes(f.type)) {
      toast.error("Unsupported file. Upload PDF, JPG, JPEG, or PNG.");
      return;
    }
    if (f.size > BANK_MAX_MB * 1024 * 1024) {
      toast.error(`File exceeds ${BANK_MAX_MB}MB limit.`);
      return;
    }
    setFile(f);
    setStatus("extracting");
    try {
      const base64 = await readFileAsBase64(f);
      const result = (await runExtract({
        data: { fileBase64: base64, mimeType: f.type },
      })) as BankExtracted;
      setExtracted(result);
      setForm({
        bankName: result.bankName ?? "",
        iban: result.iban ?? "",
        bic: result.bic ?? "",
        accountHolderName: result.accountHolderName ?? "",
        accountHolderAddress: result.accountHolderAddress ?? "",
        statementDate: result.statementDate ?? "",
      });
      const anyFound = result.iban || result.bankName || result.accountHolderName;
      setStatus(anyFound ? "review" : "extract_failed");
      if (anyFound) toast.success("Statement analysed. Please review the fields.");
      else toast.warning("We couldn't extract details. Please enter them manually.");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Extraction failed.");
      setStatus("extract_failed");
    }
  };

  const derived = useMemo(() => deriveAccountNumber(form.iban), [form.iban]);
  const ibanValid = form.iban ? isValidIban(form.iban) : false;
  const freshness = getStatementFreshness(form.statementDate);
  const canSubmit =
    status === "review" &&
    ibanValid &&
    form.bankName.trim() &&
    form.bic.trim() &&
    form.accountHolderName.trim() &&
    freshness.tone === "valid";

  return (
    <div>
      <StepHeader
        title="Bank statement"
        subtitle="Upload a recent bank statement so we can verify your account details."
      />

      {status === "idle" && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className="flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-[#0b1436]/15 bg-[#f6f7fb] p-10 text-center transition-colors hover:border-[#0b1436]/40 hover:bg-[#0b1436]/5"
        >
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#0b1436] text-[#e9c46a]">
            <Upload className="h-6 w-6" />
          </span>
          <span className="text-base font-semibold text-[#0b1436]">Upload bank statement</span>
          <span className="text-xs text-[#0b1436]/60">Statement must be from the last 6 months</span>
          <span className="text-xs text-[#0b1436]/60">
            PDF, JPG, JPEG or PNG · up to {BANK_MAX_MB}MB
          </span>
        </button>
      )}

      {status === "extracting" && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#0b1436]/10 bg-white p-10 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#0b1436]/20 border-t-[#0b1436]" />
          <p className="text-sm font-medium text-[#0b1436]">Analysing your statement…</p>
          <p className="text-xs text-[#0b1436]/60">This usually takes a few seconds.</p>
        </div>
      )}

      {(status === "review" || status === "extract_failed") && (
        <div className="space-y-5">
          {status === "extract_failed" && (
            <Alert className="border-amber-300 bg-amber-50 text-amber-900">
              <AlertTitle>Couldn't read the statement automatically</AlertTitle>
              <AlertDescription>
                Please enter the details manually below, or upload a clearer file.
              </AlertDescription>
            </Alert>
          )}

          <StatementFreshnessFlag freshness={freshness} statementDate={form.statementDate} />

          <div className="grid gap-4 sm:grid-cols-2">
            <PassportField
              id="bs-bank"
              label="Bank name"
              value={form.bankName}
              onChange={(v) => setForm({ ...form, bankName: v })}
              extractedValue={extracted?.bankName ?? null}
              confidence={extracted?.confidence.bankName ?? 0}
            />
            <PassportField
              id="bs-holder"
              label="Account holder name"
              value={form.accountHolderName}
              onChange={(v) => setForm({ ...form, accountHolderName: v })}
              extractedValue={extracted?.accountHolderName ?? null}
              confidence={extracted?.confidence.accountHolderName ?? 0}
            />
            <PassportField
              id="bs-iban"
              label="IBAN"
              value={form.iban}
              onChange={(v) => setForm({ ...form, iban: v.replace(/\s+/g, "").toUpperCase() })}
              error={form.iban && !ibanValid ? "IBAN failed checksum validation." : undefined}
              extractedValue={extracted?.iban ?? null}
              confidence={extracted?.confidence.iban ?? 0}
            />
            <PassportField
              id="bs-bic"
              label="BIC / SWIFT"
              value={form.bic}
              onChange={(v) => setForm({ ...form, bic: v.replace(/\s+/g, "").toUpperCase() })}
              extractedValue={extracted?.bic ?? null}
              confidence={extracted?.confidence.bic ?? 0}
            />
            <div className="sm:col-span-2">
              <PassportField
                id="bs-address"
                label="Account holder address"
                value={form.accountHolderAddress}
                onChange={(v) => setForm({ ...form, accountHolderAddress: v })}
                extractedValue={extracted?.accountHolderAddress ?? null}
                confidence={extracted?.confidence.accountHolderAddress ?? 0}
              />
            </div>
            <PassportField
              id="bs-date"
              label="Statement date"
              type="date"
              value={form.statementDate}
              onChange={(v) => setForm({ ...form, statementDate: v })}
              extractedValue={extracted?.statementDate ?? null}
              confidence={extracted?.confidence.statementDate ?? 0}
            />
          </div>

          <AccountNumberCard iban={form.iban} ibanValid={ibanValid} derived={derived} />

          <div className="flex items-center justify-between rounded-xl bg-[#0b1436]/5 px-4 py-3 text-xs text-[#0b1436]/70">
            <span className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5" />
              {file?.name ?? "Manual entry"}
            </span>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="font-semibold text-[#0b1436] hover:underline"
            >
              Replace statement
            </button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={BANK_ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />

      <StepNav
        onBack={onBack}
        onNext={() => {
          if (!canSubmit) {
            toast.error("Please resolve highlighted issues before finishing.");
            return;
          }
          toast.success("Bank statement verified. Finalising your application…");
          onComplete();
        }}
        nextLabel="Finish Application"
        nextDisabled={status === "idle" || status === "extracting" || !canSubmit}
      />
    </div>
  );
}

function StatementFreshnessFlag({
  freshness,
  statementDate,
}: {
  freshness: StatementFreshness;
  statementDate: string;
}) {
  const tone =
    freshness.tone === "valid"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : freshness.tone === "stale"
        ? "border-red-300 bg-red-50 text-red-800"
        : freshness.tone === "future"
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-[#0b1436]/15 bg-[#0b1436]/5 text-[#0b1436]/70";
  const label =
    freshness.tone === "valid"
      ? "Recent statement"
      : freshness.tone === "stale"
        ? "Statement too old"
        : freshness.tone === "future"
          ? "Invalid date"
          : "Unknown";
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-sm", tone)}>
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4" />
        <span className="font-semibold">6-month check: {label}</span>
        <span className="opacity-80">— {freshness.label}</span>
      </div>
      <span className="text-xs opacity-70">
        Statement {statementDate || "—"} · today {today}
      </span>
    </div>
  );
}

function AccountNumberCard({
  iban,
  ibanValid,
  derived,
}: {
  iban: string;
  ibanValid: boolean;
  derived: ReturnType<typeof deriveAccountNumber>;
}) {
  return (
    <div className="rounded-2xl border border-[#0b1436]/10 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0b1436]/60">
            Derived from IBAN
          </p>
          <p className="text-sm font-semibold text-[#0b1436]">
            Domestic bank account number
          </p>
        </div>
        <Badge
          className={cn(
            "border-transparent",
            iban && ibanValid
              ? "bg-emerald-100 text-emerald-800"
              : iban
                ? "bg-red-100 text-red-800"
                : "bg-[#0b1436]/10 text-[#0b1436]/70",
          )}
        >
          {iban ? (ibanValid ? "IBAN valid" : "IBAN invalid") : "Awaiting IBAN"}
        </Badge>
      </div>
      {derived && ibanValid ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <DerivedField label="Country" value={derived.country} />
          <DerivedField label="BBAN" value={derived.bban} mono />
          <DerivedField label="Account number" value={derived.account} mono highlight />
        </div>
      ) : (
        <p className="mt-3 text-xs text-[#0b1436]/60">
          Enter a valid IBAN to derive the domestic account number.
        </p>
      )}
    </div>
  );
}

function DerivedField({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5",
        highlight ? "border-[#e9c46a] bg-[#e9c46a]/10" : "border-[#0b1436]/10 bg-[#f6f7fb]",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0b1436]/55">
        {label}
      </p>
      <p className={cn("mt-0.5 break-all text-sm font-semibold text-[#0b1436]", mono && "font-mono")}>
        {value || "—"}
      </p>
    </div>
  );
}
