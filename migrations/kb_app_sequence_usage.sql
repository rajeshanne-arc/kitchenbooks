-- kb_app_sequence_usage
--
-- URGENT: FOUR WRITE PATHS ARE BROKEN ON PRODUCTION RIGHT NOW.
--
-- `..._and_latest_wins_tiebreak` added a `bigserial seq` to attendance,
-- day_closes, kitchen_closings and meter_readings. `bigserial` is not a type —
-- it is a bigint whose DEFAULT calls `nextval()` on a sequence the statement
-- creates as a side effect. **A role needs USAGE on that sequence to insert
-- the row**, and the migration granted none.
--
-- Measured as kb_app against production:
--
--   attendance.seq        -> attendance_seq_seq         USAGE=false
--   day_closes.seq        -> day_closes_seq_seq         USAGE=false
--   kitchen_closings.seq  -> kitchen_closings_seq_seq   USAGE=false
--   meter_readings.seq    -> meter_readings_seq_seq     USAGE=false
--
-- and an ordinary insert refused by name:
--
--   insert into attendance (…) -> permission denied for sequence attendance_seq_seq
--
-- So marking attendance, filing the nightly day close, filing a kitchen
-- closing and filing a meter reading all fail. That is the restaurant's whole
-- evening, and it fails at the moment of saving rather than on the way in —
-- the person has already keyed the sheet.
--
-- THE LESSON, and it is the transferable half: `GENERATED ALWAYS AS IDENTITY`
-- would have needed NO grant at all. An identity column's sequence is reached
-- through the table's own INSERT privilege; a `serial`'s default calls
-- `nextval()` directly and therefore needs its own. Two spellings of the same
-- intention, one of which quietly requires a second grant. Prefer IDENTITY for
-- the next one.

begin;

grant usage on sequence public.attendance_seq_seq        to kb_app;
grant usage on sequence public.day_closes_seq_seq        to kb_app;
grant usage on sequence public.kitchen_closings_seq_seq  to kb_app;
grant usage on sequence public.meter_readings_seq_seq    to kb_app;

commit;

-- USAGE only, not USAGE+SELECT: nextval() needs USAGE, and SELECT would only
-- add the ability to read last_value, which nothing does.
--
-- OPTIONAL, and the structural version of the same fix — the equivalent of
-- resolving the tie in the schema rather than relying on whoever writes the
-- next migration to remember:
--
--   alter default privileges for role postgres in schema public
--     grant usage on sequences to kb_app;
--
-- That covers sequences created LATER by that role, and does nothing for the
-- four above (hence the explicit grants). It is worth having, and it is still
-- not a substitute for the gate: `smoke:a2` now walks every table kb_app may
-- INSERT into, finds every column whose default is a nextval(), and fails
-- naming any whose sequence kb_app cannot use. That is what catches the fifth
-- one — including a sequence created by some other role, which default
-- privileges would miss.
