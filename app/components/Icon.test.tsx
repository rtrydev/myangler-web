import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import {
  SearchIcon,
  CloseIcon,
  StarIcon,
  StarFillIcon,
  ClockIcon,
  BookIcon,
  SpeakerIcon,
  CopyIcon,
  ShareIcon,
  ArrowIcon,
  BackIcon,
  MenuIcon,
  TrashIcon,
  OfflineIcon,
  SunIcon,
  MoonIcon,
  SettingsIcon,
} from "./Icon";

const icons = [
  ["SearchIcon", SearchIcon],
  ["CloseIcon", CloseIcon],
  ["StarIcon", StarIcon],
  ["StarFillIcon", StarFillIcon],
  ["ClockIcon", ClockIcon],
  ["BookIcon", BookIcon],
  ["SpeakerIcon", SpeakerIcon],
  ["CopyIcon", CopyIcon],
  ["ShareIcon", ShareIcon],
  ["ArrowIcon", ArrowIcon],
  ["BackIcon", BackIcon],
  ["MenuIcon", MenuIcon],
  ["TrashIcon", TrashIcon],
  ["OfflineIcon", OfflineIcon],
  ["SunIcon", SunIcon],
  ["MoonIcon", MoonIcon],
  ["SettingsIcon", SettingsIcon],
] as const;

describe("Icon set", () => {
  test.each(icons)("%s renders an SVG element", (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  test("size prop controls width and height attributes", () => {
    const { container } = render(<SearchIcon size={42} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("42");
    expect(svg.getAttribute("height")).toBe("42");
  });

  test("default size is 24", () => {
    const { container } = render(<SearchIcon />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("height")).toBe("24");
  });

  test("StarFillIcon uses currentColor as fill", () => {
    const { container } = render(<StarFillIcon />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("fill")).toBe("currentColor");
  });

  test("outlined icons use currentColor stroke and no fill", () => {
    const { container } = render(<SearchIcon />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
  });

  test("extra props (aria-label, role) are forwarded to the svg", () => {
    const { container } = render(<SearchIcon aria-label="search" role="img" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-label")).toBe("search");
    expect(svg.getAttribute("role")).toBe("img");
  });
});
