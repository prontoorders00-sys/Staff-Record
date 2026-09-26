-- INSERT RETURNING is checked before the AFTER INSERT membership trigger.
-- Let the authenticated creator read their own new business immediately.
drop policy if exists "businesses: members can read" on public.businesses;
create policy "businesses: members can read" on public.businesses for select to authenticated
  using (owner_user_id = (select auth.uid()) or private.is_business_member(id));
