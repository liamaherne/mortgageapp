
CREATE TABLE public.applications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  address TEXT,
  extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  audit_trail JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.applications TO service_role;

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- No policies: table is only accessible via server-side code (service role).
