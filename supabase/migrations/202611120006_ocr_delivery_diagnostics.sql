-- 可选、无正文的OCR关联，以及不可变导出快照六类门禁。旧记录保持可读。
alter table public.source_resumes add column if not exists parse_id text;
alter table public.resume_exports add column if not exists delivery_state jsonb;
