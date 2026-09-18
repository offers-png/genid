-- GenID Protocol: bind a staged Polygon anchor to the exact content it
-- anchored (Sept 18 third follow-up)
--
-- recordPolygonAnchorTx (migration 010) persists polygon_anchor_tx as soon
-- as a Polygon transaction succeeds, before the rest of finalize completes
-- — so a retry (even one that reclaimed a stale lock) can skip re-anchoring
-- if nothing changed. But without recording WHICH root hash that
-- transaction anchored, a failed finalize followed by an edit (which
-- changes the step list, and so the root hash) had no way to tell "this
-- leftover anchor is for the current content" apart from "this leftover
-- anchor is for content that no longer exists." The finalize route now
-- only reuses polygon_anchor_tx when polygon_anchor_root_hash matches the
-- root hash it's about to finalize with; otherwise it re-anchors.
alter table genid_sessions
  add column if not exists polygon_anchor_root_hash text;
