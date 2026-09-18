-- A VENDOR PAYMENT BY TRANSFER IS A REQUEST, NOT A RECORD.
--
-- The store manager observes what is owed and that he handed over cash. He
-- does not make bank transfers, and recording one he did not make is writing
-- down hearsay. So bank / UPI / cheque / card raise an approval request and
-- the owner records the payment when they make it — choosing the account at
-- the moment the money moves, which is the only moment anybody can know it.
--
-- approval_requests already carries reason (NOT NULL, which is right: after a
-- payment there is no negative twin, so the reason is the only account anyone
-- will ever have of why it was made) and a jsonb snapshot, which is where the
-- amount, the urgency and the ageing at the time of asking live.
--
-- Until this is applied, the transfer branch of Store > Purchasing > Pay
-- cannot save: the CHECK refuses the row. The app catches that specific
-- violation and names this migration rather than showing a constraint error.

alter table approval_requests drop constraint if exists approval_requests_kind_check;

alter table approval_requests add constraint approval_requests_kind_check
  check (kind = any (array['discard', 'merge', 'reopen_period', 'payment', 'advance', 'other']));
