// @vitest-environment jsdom
/**
 * Component tests for DigestModal — covers the E-series rubric dimensions
 * from `rubrics/milestone-m4-digest.md` that don't require a real browser:
 *   E1: modal opens
 *   E2: client-side email validation (no network on bad input)
 *   E3: 5 category checkboxes present
 *   E4: submit disabled while in-flight
 *   E5: success state visible after 200
 *   E6: error state visible on 500
 *   E7: Esc closes (backdrop + X also tested here)
 *
 * Runs in jsdom (see vitest.config.ts environmentMatchGlobs).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DigestButton } from "@/app/components/digest-button";
import { DigestModal } from "@/app/components/digest-modal";

afterEach(() => cleanup());

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("DigestButton + DigestModal — E1 modal opens", () => {
  it("clicking the button mounts the modal", () => {
    render(<DigestButton />);
    expect(screen.queryByTestId("digest-modal")).toBeNull();
    fireEvent.click(screen.getByTestId("digest-button"));
    expect(screen.getByTestId("digest-modal")).toBeTruthy();
    // Modal title element specifically (button + dialog title both match the
    // phrase, so target the heading by id).
    expect(document.getElementById("digest-modal-title")?.textContent).toMatch(
      /Email me this week/i,
    );
  });
});

describe("DigestModal — E2 client-side email validation", () => {
  it("rejects malformed email without firing a network call", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<DigestModal onClose={() => {}} />);
    const input = screen.getByTestId("digest-email-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.click(screen.getByTestId("digest-submit"));

    expect(screen.getByTestId("digest-email-error")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("DigestModal — E3 categories", () => {
  it("renders all 5 category checkboxes", () => {
    render(<DigestModal onClose={() => {}} />);
    for (const c of ["music", "comedy", "lectures", "dancing", "food"]) {
      expect(screen.getByTestId(`digest-category-${c}`)).toBeTruthy();
    }
  });
});

describe("DigestModal — E4 in-flight + E5 success", () => {
  it("disables submit while pending and shows success after 200", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    mockFetchOnce(() => pending);

    render(<DigestModal onClose={() => {}} />);
    fireEvent.change(screen.getByTestId("digest-email-input"), {
      target: { value: "ok@example.com" },
    });
    fireEvent.click(screen.getByTestId("digest-submit"));

    const submit = screen.getByTestId("digest-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toMatch(/Sending/i);

    resolveFetch(
      new Response(
        JSON.stringify({ ok: true, eventsIncluded: 17, messageId: "msg_x" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await waitFor(() => {
      expect(screen.getByTestId("digest-success")).toBeTruthy();
    });
    expect(screen.getByText(/17 events included/i)).toBeTruthy();
  });
});

describe("DigestModal — E6 error state", () => {
  it("shows an error message on non-200", async () => {
    mockFetchOnce(async () => {
      return new Response(JSON.stringify({ error: "server boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    });

    render(<DigestModal onClose={() => {}} />);
    fireEvent.change(screen.getByTestId("digest-email-input"), {
      target: { value: "ok@example.com" },
    });
    fireEvent.click(screen.getByTestId("digest-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("digest-error")).toBeTruthy();
    });
    expect(screen.getByTestId("digest-error").textContent).toMatch(/server boom/);
  });
});

describe("DigestModal — E7 dismiss", () => {
  it("Esc, backdrop click, and X all close the modal", () => {
    // Esc
    const onCloseEsc = vi.fn();
    const { unmount: unmountEsc } = render(<DigestModal onClose={onCloseEsc} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCloseEsc).toHaveBeenCalled();
    unmountEsc();

    // Backdrop
    const onCloseBackdrop = vi.fn();
    const { unmount: unmountBd } = render(
      <DigestModal onClose={onCloseBackdrop} />,
    );
    fireEvent.click(screen.getByTestId("digest-modal-backdrop"));
    expect(onCloseBackdrop).toHaveBeenCalled();
    unmountBd();

    // X
    const onCloseX = vi.fn();
    render(<DigestModal onClose={onCloseX} />);
    fireEvent.click(screen.getByTestId("digest-modal-close"));
    expect(onCloseX).toHaveBeenCalled();
  });
});
