-- PrintFlow — product image storage
--
-- Files are stored under "<organization_id>/<product_id>/<file>". The bucket is
-- public-read because product photos are marketing images that end up on
-- marketplace listings anyway; only organization members can upload or delete.
--
-- Guarded so the migration also applies on Postgres instances without the
-- Supabase storage schema (e.g. plain CI databases).

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; skipping product image bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('product-images', 'product-images', true, 5242880,
          array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
  on conflict (id) do nothing;

  execute $p$
    create policy "org members upload product images" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'product-images'
        and public.is_org_member(((storage.foldername(name))[1])::uuid)
      )
  $p$;

  execute $p$
    create policy "org members update product images" on storage.objects
      for update to authenticated
      using (
        bucket_id = 'product-images'
        and public.is_org_member(((storage.foldername(name))[1])::uuid)
      )
  $p$;

  execute $p$
    create policy "org members delete product images" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'product-images'
        and public.is_org_member(((storage.foldername(name))[1])::uuid)
      )
  $p$;
end;
$$;
