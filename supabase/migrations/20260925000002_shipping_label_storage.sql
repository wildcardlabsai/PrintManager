-- Private bucket for carrier label PDFs. No storage policies: only the server
-- (service role) reads/writes it, and labels are downloaded through an
-- authenticated route that checks organization membership.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; skipping shipping-labels bucket';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('shipping-labels', 'shipping-labels', false, 10485760, array['application/pdf'])
  on conflict (id) do nothing;
end;
$$;
