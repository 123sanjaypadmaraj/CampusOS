-- =============================================================================
-- 0022: VENDOR DASHBOARD -- per-vendor CRUD isolation for the food menu and
-- print pricing (doc §16 vendor portal).
-- =============================================================================
-- canteens_write / food_items_write previously granted ANY account holding
-- the 'food.menu.write' permission blanket write access to every canteen's
-- menu -- harmless while only admins held that permission, not once real,
-- separate vendor accounts exist per canteen. Re-scope both to
-- canteens.owner_id so a vendor can only ever touch their own canteen and
-- its items; current_user_is_admin() keeps full cross-canteen access.
-- print_rate_card gets the same owner_id + ownership-scoped policy so the
-- print shop's vendor account can edit its own page prices without needing
-- full admin rights.

alter table public.print_rate_card add column if not exists owner_id uuid references public.profiles(id) on delete set null;

-- ---- canteens ----

drop policy if exists "canteens_write" on public.canteens;
create policy "canteens_write" on public.canteens for all to authenticated
  using (
    public.current_user_is_admin()
    or (public.has_permission(auth.uid(),'food.menu.write') and owner_id = auth.uid())
  )
  with check (
    public.current_user_is_admin()
    or (public.has_permission(auth.uid(),'food.menu.write') and owner_id = auth.uid())
  );

-- canteens_read only shows active=true rows (correct for students/public);
-- a vendor needs to see + edit their own canteen even while it's marked
-- inactive, same reasoning as 0018's admin read policies.
drop policy if exists "canteens_vendor_read" on public.canteens;
create policy "canteens_vendor_read" on public.canteens for select to authenticated
  using (owner_id = auth.uid());

-- ---- food_items ----

drop policy if exists "food_items_write" on public.food_items;
create policy "food_items_write" on public.food_items for all to authenticated
  using (
    public.current_user_is_admin()
    or (
      public.has_permission(auth.uid(),'food.menu.write')
      and exists (select 1 from public.canteens c where c.id = food_items.canteen_id and c.owner_id = auth.uid())
    )
  )
  with check (
    public.current_user_is_admin()
    or (
      public.has_permission(auth.uid(),'food.menu.write')
      and exists (select 1 from public.canteens c where c.id = food_items.canteen_id and c.owner_id = auth.uid())
    )
  );

drop policy if exists "food_items_vendor_read" on public.food_items;
create policy "food_items_vendor_read" on public.food_items for select to authenticated
  using (exists (select 1 from public.canteens c where c.id = food_items.canteen_id and c.owner_id = auth.uid()));

-- ---- food_categories ----
-- Shared reference data every canteen's items point into -- letting any
-- vendor rename/delete a category another vendor's menu depends on is a
-- real footgun. Restrict writes to admins; the vendor UI only ever picks
-- from the existing list, same as the admin CMS form already does.
drop policy if exists "food_categories_write" on public.food_categories;
create policy "food_categories_write" on public.food_categories for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- ---- print_rate_card ----

drop policy if exists "print_rate_card_write" on public.print_rate_card;
create policy "print_rate_card_write" on public.print_rate_card for all to authenticated
  using (
    public.current_user_is_admin()
    or (public.has_permission(auth.uid(),'print.manage') and owner_id = auth.uid())
  )
  with check (
    public.current_user_is_admin()
    or (public.has_permission(auth.uid(),'print.manage') and owner_id = auth.uid())
  );

create index if not exists print_rate_card_owner_idx on public.print_rate_card(owner_id);
