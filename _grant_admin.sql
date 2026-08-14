
    do $$ begin
      perform set_config('campusos.allow_role_change', 'true', true);
      update public.profiles set role = 'super_admin' where id = '15d0720f-3bf4-49bb-bb98-0f0bcf1caead';
    end $$;
  