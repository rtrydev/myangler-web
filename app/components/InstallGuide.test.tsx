import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallGuide } from "./InstallGuide";

describe("InstallGuide", () => {
  test("renders nothing when closed", () => {
    render(
      <InstallGuide open={false} onClose={() => {}} platform="ios" />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("install-guide")).not.toBeInTheDocument();
  });

  test("renders as a labeled dialog with the iOS steps by default for ios platform", () => {
    render(
      <InstallGuide open={true} onClose={() => {}} platform="ios" />,
    );
    const dialog = screen.getByRole("dialog", { name: /install myangler/i });
    expect(dialog).toBeInTheDocument();

    // iOS tab is the active one — `aria-selected` reflects state.
    expect(screen.getByTestId("install-tab-ios")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("install-tab-android")).toHaveAttribute(
      "aria-selected",
      "false",
    );

    // The list is labeled and has the four iOS steps.
    const list = within(dialog).getByRole("list", {
      name: /install on iphone or ipad/i,
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(
      within(list).getByText(/safari/i, { exact: false }),
    ).toBeInTheDocument();
  });

  test("renders the Android steps when platform=android", () => {
    render(
      <InstallGuide open={true} onClose={() => {}} platform="android" />,
    );
    expect(screen.getByTestId("install-tab-android")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("list", { name: /install on android/i }),
    ).toBeInTheDocument();
  });

  test("unknown platforms ('other') fall back to iOS steps", () => {
    render(
      <InstallGuide open={true} onClose={() => {}} platform="other" />,
    );
    expect(screen.getByTestId("install-tab-ios")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("clicking the inactive tab swaps the visible step list", async () => {
    const user = userEvent.setup();
    render(
      <InstallGuide open={true} onClose={() => {}} platform="ios" />,
    );

    await user.click(screen.getByTestId("install-tab-android"));
    expect(screen.getByTestId("install-tab-android")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("list", { name: /install on android/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: /install on iphone or ipad/i }),
    ).not.toBeInTheDocument();
  });

  test("the header Close button fires onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <InstallGuide open={true} onClose={onClose} platform="ios" />,
    );
    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test("the footer Got it button fires onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <InstallGuide open={true} onClose={onClose} platform="ios" />,
    );
    await user.click(screen.getByTestId("install-guide-done"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
