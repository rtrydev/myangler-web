import { describe, expect, test } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { EngineProvider, useEngineState } from "./engine-context";
import { buildAppEngine } from "./__fixtures__/buildAppFixture";

describe("EngineProvider", () => {
  test("emits ready immediately when a pre-built engine is supplied", async () => {
    const engine = await buildAppEngine();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EngineProvider engine={engine}>{children}</EngineProvider>
    );
    const { result } = renderHook(() => useEngineState(), { wrapper });
    expect(result.current.status).toBe("ready");
    if (result.current.status === "ready") {
      expect(result.current.engine).toBe(engine);
    }
  });

  test("Consumer outside the provider throws", () => {
    expect(() => renderHook(() => useEngineState())).toThrow(/EngineProvider/);
  });

  test("renders children once ready", async () => {
    const engine = await buildAppEngine();
    render(
      <EngineProvider engine={engine}>
        <div>app body</div>
      </EngineProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("app body")).toBeInTheDocument();
    });
  });
});
