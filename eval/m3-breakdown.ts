import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
(async () => {
  console.log("=== D2 breakdown (price_min, price_max, is_free all empty) ===");
  const d2 = await sql<{ source: string; count: number }[]>`
    select source, count(*)::int as count
    from events
    where source like 'scrape:%'
      and price_min is null and price_max is null and is_free = false
    group by source order by count desc
  `;
  for (const r of d2) console.log(`  ${r.source.padEnd(28)} ${r.count}`);

  console.log("\n=== D6 breakdown (start_time > 7d in past) ===");
  const d6 = await sql<{ source: string; count: number; oldest: Date; newest: Date }[]>`
    select source, count(*)::int as count, min(start_time_utc) as oldest, max(start_time_utc) as newest
    from events
    where source like 'scrape:%' and start_time_utc < now() - interval '7 days'
    group by source order by count desc
  `;
  for (const r of d6) console.log(`  ${r.source.padEnd(28)} ${r.count}  oldest=${r.oldest.toISOString().slice(0,10)} newest=${r.newest.toISOString().slice(0,10)}`);

  console.log("\n=== Pricing-distribution by source ===");
  const dist = await sql<{ source: string; free: number; priced: number; varies: number; total: number }[]>`
    select source,
      sum(case when is_free then 1 else 0 end)::int as free,
      sum(case when price_min is not null or price_max is not null then 1 else 0 end)::int as priced,
      sum(case when price_min is null and price_max is null and is_free=false then 1 else 0 end)::int as varies,
      count(*)::int as total
    from events
    where source like 'scrape:%'
    group by source order by source
  `;
  for (const r of dist) console.log(`  ${r.source.padEnd(28)} free=${String(r.free).padStart(3)} priced=${String(r.priced).padStart(3)} varies=${String(r.varies).padStart(3)} total=${r.total}`);

  await sql.end();
})();
