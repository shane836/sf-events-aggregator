-- Reviewed cleanup for the nine Independent conflicts observed 2026-10-24.
-- Preserves the official event IDs and all distinct source identities.
-- Retires nine duplicate Ticketmaster event IDs (old direct links will expire).
-- Take a fresh provider-native recovery point and stop ingestion before applying.
-- DEFAULT IS A REHEARSAL: the final ROLLBACK leaves production unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE events IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE independent_cleanup (
  keep_id uuid, drop_id uuid, external_id text, ticket_id text,
  keep_fingerprint text, drop_fingerprint text
) ON COMMIT DROP;
INSERT INTO independent_cleanup VALUES
('d1f06eed-df90-4774-8dfb-38aca94821a5','e91d9196-9f1d-4ea2-afad-a11301d7b2e2','stop-light-observation','rZ7HnEZ1Af0U4d','94431d02cf5e57c2c33b1a8421bb9838','1259f80d4cb50e1e571c7d7a52059f6f'),
('28fa7635-27b5-4de2-8b09-06215ab03f99','3eb9571d-79f5-4736-aa76-a0057765a606','sean-hayes','rZ7HnEZ1AfPzfN','d92ef9bc04dfcedce32cb9bb9d0ede60','2a760cf04707196db4d68d929bb0bacf'),
('0a49dabf-37a2-4379-b007-cd07b7365797','bfbb1541-8b36-4f12-9d22-714e6c48f0a4','feeble-little-horse-with-mop','rZ7HnEZ1Af0UZN','db8d79e67ec47352c0571236e0caf344','f2e9ffc5b0d77ec2214a0b474e37ea7e'),
('898c2d2c-80bb-4f27-8e57-9c78f369bec5','85b6c175-2f83-45bf-b572-d785657f0618','the-polish-ambassador-2','rZ7HnEZ1AfuIO7','2aa9424cf17188314062fc479754b42d','cace4c1ee18001d2bf546c40676b49a2'),
('6c1fe5dc-2a7b-41f1-949d-54a937fc50f5','678f90da-22bd-4ef5-84f1-383c7d263541','tapers-choice','rZ7HnEZ1AfuUp7','663145e5ec8ef407799aac0acfc14985','7664844bf4543cdd547d606ffc74c8e3'),
('940b3c83-06fd-476b-8656-32f9757435bd','6375c63c-1f05-4d70-8114-2925a4b1704b','way-dynamic','rZ7HnEZ1AfPZAN','542703e243b0bcb88399afcad2a2928a','a6c72373433d6a79013294eff366ba00'),
('a9af9dcd-9e64-429e-b085-e31b88799d9a','b45fef97-dd3b-4aab-a86e-9b57314b7706','jack-kays','rZ7HnEZ1Afudaf','3d001b8ff6cc60856e8ed35607c1aea5','507895110d918ed0c9c09a568a02312a'),
('0e931c70-5c61-434d-88c4-38d2ba10e679','935b1fab-de8d-40f4-a4ef-1c8ff0a506a5','cg5','rZ7HnEZ1AfCk_f','5f2bba3af9ac47505375ee809b032785','5e50a999404559f24681236464040b85'),
('06c2eccc-ec42-414d-a404-a1454d2517c8','6f3cb20c-8538-4c3f-935e-9ff73b7c2c03','evan-giia','rZ7HnEZ1AfF61f','48c6b3d66da80fe60da6d73493e66571','2a3504132187013996ad9b5aa29f473f');
DO $$
BEGIN
  IF (SELECT count(*) FROM independent_cleanup p JOIN events k ON k.id=p.keep_id JOIN events d ON d.id=p.drop_id
      WHERE k.source='scrape:independent' AND k.external_id=p.external_id
      AND d.source='ticketmaster' AND d.external_id=p.ticket_id
      AND k.canonical_fingerprint=p.keep_fingerprint AND d.canonical_fingerprint=p.drop_fingerprint
      AND k.venue_id=d.venue_id AND k.verification_level='official'
      AND jsonb_typeof(k.secondary_sources)='array' AND jsonb_typeof(d.secondary_sources)='array') <> 9 THEN
    RAISE EXCEPTION 'Cleanup preconditions changed; review all nine pairs again';
  END IF;
  IF EXISTS (SELECT 1 FROM independent_cleanup p JOIN events e ON e.id IN (p.keep_id,p.drop_id)
      CROSS JOIN LATERAL jsonb_array_elements(e.secondary_sources) item
      WHERE jsonb_typeof(item)<>'object' OR nullif(item->>'source','') IS NULL OR nullif(item->>'externalId','') IS NULL) THEN
    RAISE EXCEPTION 'Malformed attribution; review before merging';
  END IF;
  IF EXISTS (SELECT 1 FROM independent_cleanup p JOIN events e
      ON (e.secondary_sources @> jsonb_build_array(jsonb_build_object('source','ticketmaster','externalId',p.ticket_id))
      OR e.secondary_sources @> jsonb_build_array(jsonb_build_object('source','scrape:independent','externalId',p.external_id)))
      WHERE e.id NOT IN (p.keep_id,p.drop_id)) THEN
    RAISE EXCEPTION 'Ticketmaster identity has another attribution; review before merging';
  END IF;
END $$;
UPDATE events k SET secondary_sources = (
  SELECT coalesce(jsonb_agg(item), '[]'::jsonb) FROM (
    SELECT DISTINCT ON (item->>'source', item->>'externalId') item
    FROM jsonb_array_elements(k.secondary_sources || d.secondary_sources || jsonb_build_array(jsonb_build_object(
      'source',d.source,'externalId',d.external_id,'sourceUrl',d.source_url,
      'verificationLevel',d.verification_level,'observedAt',d.ingested_at
    ))) item
    WHERE NOT (item->>'source'=k.source AND item->>'externalId'=k.external_id)
    ORDER BY item->>'source',item->>'externalId',item->>'observedAt' DESC NULLS LAST
  ) unique_sources
)
FROM independent_cleanup p JOIN events d ON d.id=p.drop_id WHERE k.id=p.keep_id;
DELETE FROM events d USING independent_cleanup p WHERE d.id=p.drop_id;
DO $$
BEGIN
  IF (SELECT count(*) FROM independent_cleanup p JOIN events k ON k.id=p.keep_id
      WHERE k.secondary_sources @> jsonb_build_array(jsonb_build_object('source','ticketmaster','externalId',p.ticket_id))) <> 9
      OR EXISTS (SELECT 1 FROM independent_cleanup p JOIN events d ON d.id=p.drop_id) THEN
    RAISE EXCEPTION 'Cleanup verification failed';
  END IF;
END $$;
SELECT k.id,k.title,k.source,k.external_id,k.secondary_sources
FROM events k JOIN independent_cleanup p ON p.keep_id=k.id ORDER BY k.title;
ROLLBACK;
