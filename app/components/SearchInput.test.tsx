import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { SearchInput } from "./SearchInput";

function Controlled({ onClear }: { onClear?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <SearchInput
      aria-label="Search"
      placeholder="search a word"
      value={value}
      onChange={e => setValue(e.target.value)}
      onClear={
        onClear
          ? () => {
              setValue("");
              onClear();
            }
          : undefined
      }
    />
  );
}

describe("SearchInput", () => {
  test("renders a textbox with the given placeholder", () => {
    render(<SearchInput aria-label="Search" placeholder="search a word" />);
    expect(screen.getByRole("textbox", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("search a word")).toBeInTheDocument();
  });

  test("reflects typed text into the input value", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole("textbox", { name: "Search" });
    await user.type(input, "water");
    expect(input).toHaveValue("water");
  });

  test("fires onChange for each typed character", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SearchInput
        aria-label="Search"
        value=""
        onChange={onChange}
        placeholder="search"
      />
    );
    await user.type(screen.getByRole("textbox", { name: "Search" }), "abc");
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  test("the clear button appears only when there is a value and onClear is provided", async () => {
    const user = userEvent.setup();
    render(<Controlled onClear={() => {}} />);

    // empty: no clear button
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Search" }), "x");
    expect(screen.getByRole("button", { name: /clear/i })).toBeInTheDocument();
  });

  test("no clear button when onClear is not provided, even with a value", () => {
    render(
      <SearchInput
        aria-label="Search"
        value="water"
        onChange={() => {}}
        placeholder="search"
      />
    );
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();
  });

  test("clicking the clear button calls onClear and empties the field", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<Controlled onClear={onClear} />);

    const input = screen.getByRole("textbox", { name: "Search" });
    await user.type(input, "water");
    expect(input).toHaveValue("water");

    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(input).toHaveValue("");
  });

  test("input is reachable by keyboard tab", async () => {
    const user = userEvent.setup();
    render(<SearchInput aria-label="Search" placeholder="search" />);
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveFocus();
  });
});
