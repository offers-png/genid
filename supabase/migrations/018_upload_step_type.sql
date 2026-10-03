-- External API certification pipeline (Oct 2026) — a session can now start
-- from an externally-generated image (Higgsfield, HeyGen, Midjourney, etc.)
-- uploaded via the API, as an alternative to GenID's own OpenAI generation
-- step. 'upload' is a new step_type alongside the existing
-- generate/regenerate/edit/discard — everything downstream (hash-chaining,
-- C2PA manifest, Polygon anchor, certificate PDF) is already generic over
-- step_type and needs no changes; only this CHECK constraint does.
alter table public.genid_steps drop constraint genid_steps_step_type_check;
alter table public.genid_steps add constraint genid_steps_step_type_check
  check (step_type in ('generate', 'regenerate', 'edit', 'discard', 'upload'));
