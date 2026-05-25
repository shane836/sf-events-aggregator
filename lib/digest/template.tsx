/**
 * Email digest template — react-email JSX.
 *
 * Rendered server-side via `@react-email/render` into HTML + plain-text
 * alternatives, then handed to Resend. Light-only by default; honors
 * `prefers-color-scheme: dark` where the client supports it via a `<style>`
 * block in `<Head>` (Apple Mail, recent Outlook web).
 *
 * Hard constraints (per `rubrics/milestone-m4-digest.md`):
 *   - Every event row has an anchor with `href=<sourceUrl>` (B3)
 *   - Every event row shows priceDisplay (B4)
 *   - Title, venue, date present per row (B6)
 *   - No "unsubscribe" link (F3)
 *   - Valid HTML — single anchors per row, no nesting (B5)
 */
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import type { Category } from "@/lib/sources/types";
import { CATEGORY_EMAIL_HEX, CATEGORY_LABEL } from "./category-styles";
import type { DigestEvent } from "./types";

type Props = {
  events: DigestEvent[];
  /** ISO date string for the "week of" header (Monday of digest window in PT). */
  weekOfLabel: string;
  /** Public site URL for "back to calendar" link in the empty-state. */
  siteUrl?: string;
  /** Categories selected in the modal; used for the empty-state copy. */
  selectedCategories?: Category[] | null;
};

function formatEventDateTime(isoUtc: string, timezone: string): string {
  // Intl in the local tz: e.g. "Fri, Jun 6 · 8:00 PM"
  const d = new Date(isoUtc);
  const dateStr = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  }).format(d);
  const timeStr = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(d);
  return `${dateStr} · ${timeStr}`;
}

const PALETTE = {
  bg: "#ffffff",
  surface: "#fafafa",
  text: "#18181b", // zinc-900
  textMuted: "#52525b", // zinc-600
  textFaint: "#a1a1aa", // zinc-400
  border: "#e4e4e7", // zinc-200
  link: "#2563eb", // blue-600
};

// Plain-string style maps. react-email serializes these as inline `style=""`.
const styles = {
  body: {
    backgroundColor: PALETTE.bg,
    color: PALETTE.text,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    margin: 0,
    padding: 0,
  },
  container: {
    maxWidth: "640px",
    margin: "0 auto",
    padding: "32px 24px 48px",
  },
  brand: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
    fontSize: "12px",
    letterSpacing: "0.3em",
    textTransform: "uppercase" as const,
    color: PALETTE.textFaint,
    margin: "0 0 8px",
  },
  title: {
    fontSize: "24px",
    fontWeight: 600,
    color: PALETTE.text,
    margin: "0 0 4px",
    lineHeight: 1.2,
  },
  subtitle: {
    fontSize: "14px",
    color: PALETTE.textMuted,
    margin: "0 0 24px",
  },
  hr: {
    borderColor: PALETTE.border,
    margin: "16px 0",
  },
  eventTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: PALETTE.text,
    margin: "0 0 4px",
    lineHeight: 1.3,
    textDecoration: "none",
  },
  eventMeta: {
    fontSize: "13px",
    color: PALETTE.textMuted,
    margin: "0 0 6px",
  },
  eventFooter: {
    fontSize: "13px",
    color: PALETTE.textMuted,
    margin: "0 0 8px",
  },
  categoryBadge: (cat: Category) => ({
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: CATEGORY_EMAIL_HEX[cat],
    marginRight: "8px",
  }),
  emptyState: {
    backgroundColor: PALETTE.surface,
    border: `1px solid ${PALETTE.border}`,
    borderRadius: "8px",
    padding: "24px",
    margin: "16px 0",
  },
  footer: {
    fontSize: "12px",
    color: PALETTE.textFaint,
    margin: "32px 0 0",
    textAlign: "center" as const,
  },
};

// Inline dark-mode override: clients that honor prefers-color-scheme
// (Apple Mail, recent Outlook) will pick this up. Others ignore the block.
const DARK_MODE_CSS = `
@media (prefers-color-scheme: dark) {
  .digest-body { background-color: #09090b !important; color: #fafafa !important; }
  .digest-container { background-color: #09090b !important; }
  .digest-title, .digest-event-title { color: #fafafa !important; }
  .digest-subtitle, .digest-meta, .digest-footer-text { color: #a1a1aa !important; }
  .digest-empty { background-color: #18181b !important; border-color: #27272a !important; }
  .digest-hr { border-color: #27272a !important; }
}
`;

export function DigestEmail({
  events,
  weekOfLabel,
  siteUrl,
  selectedCategories,
}: Props): React.ReactElement {
  const preview = events.length
    ? `${events.length} event${events.length === 1 ? "" : "s"} in SF this week`
    : "No events match your selection this week";

  return (
    <Html lang="en">
      <Head>
        <style dangerouslySetInnerHTML={{ __html: DARK_MODE_CSS }} />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={styles.body} className="digest-body">
        <Container style={styles.container} className="digest-container">
          <Text style={styles.brand}>SF Events</Text>
          <Text style={styles.title} className="digest-title">
            Your week in San Francisco
          </Text>
          <Text style={styles.subtitle} className="digest-subtitle">
            Week of {weekOfLabel}
          </Text>
          <Hr style={styles.hr} className="digest-hr" />

          {events.length === 0 ? (
            <EmptyState
              siteUrl={siteUrl}
              selectedCategories={selectedCategories}
            />
          ) : (
            events.map((e, i) => (
              <EventRow key={e.id} event={e} isLast={i === events.length - 1} />
            ))
          )}

          <Text style={styles.footer} className="digest-footer-text">
            One-time send. We don&apos;t store your email beyond this delivery
            record.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

function EventRow({
  event,
  isLast,
}: {
  event: DigestEvent;
  isLast: boolean;
}): React.ReactElement {
  const when = formatEventDateTime(event.startTimeUtc, event.timezone);
  const venueLine = event.venue.neighborhood
    ? `${event.venue.name} · ${event.venue.neighborhood}`
    : event.venue.name;

  return (
    <Section style={{ marginBottom: isLast ? 0 : "20px" }}>
      <Text style={styles.eventMeta} className="digest-meta">
        <span style={styles.categoryBadge(event.category)}>
          {CATEGORY_LABEL[event.category]}
        </span>
        {when}
      </Text>
      <Link
        href={event.sourceUrl}
        style={styles.eventTitle}
        className="digest-event-title"
      >
        {event.title}
      </Link>
      <Text style={styles.eventFooter} className="digest-meta">
        {venueLine} · {event.priceDisplay}
      </Text>
      {!isLast && <Hr style={styles.hr} className="digest-hr" />}
    </Section>
  );
}

function EmptyState({
  siteUrl,
  selectedCategories,
}: {
  siteUrl?: string;
  selectedCategories?: Category[] | null;
}): React.ReactElement {
  const filterCopy =
    selectedCategories && selectedCategories.length > 0
      ? `your selected ${selectedCategories.length === 1 ? "category" : "categories"} (${selectedCategories
          .map((c) => CATEGORY_LABEL[c])
          .join(", ")})`
      : "your selection";

  return (
    <Section style={styles.emptyState} className="digest-empty">
      <Text style={{ ...styles.eventMeta, marginBottom: "8px" }}>
        No events match {filterCopy} in the next 7 days.
      </Text>
      <Text style={{ ...styles.eventMeta, margin: 0 }}>
        Browse the full calendar:&nbsp;
        <Link href={siteUrl ?? "https://sf-events-aggregator.vercel.app"}>
          sf-events-aggregator.vercel.app
        </Link>
      </Text>
    </Section>
  );
}

export default DigestEmail;
