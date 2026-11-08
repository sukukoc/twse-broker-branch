/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";
import { buildSnapshot } from "../src/lib/assemble";
import { loadVendorPayloads } from "../src/lib/vendor";

const snapshot = buildSnapshot({
  now: new Date("2026-11-08T04:00:00.000Z"),
  payloads: loadVendorPayloads("data/vendor/2026-11-08"),
  previous: null,
  previousBars: [],
}).snapshot;

afterEach(() => cleanup());

describe("directory ui", () => {
  it("searches a real bond and keeps premium controls disabled", async () => {
    window.location.hash = "#/";
    render(<App initialSnapshot={snapshot} />);
    expect(screen.getByRole("heading", { name: "可轉債研究雷達" })).toBeTruthy();
    expect(screen.getAllByText("台泥一永").length).toBeGreaterThan(0);
    expect(screen.getAllByText("尚未開放的篩選").length).toBeGreaterThan(0);
    expect((screen.getByLabelText("市場轉換溢價下限") as HTMLInputElement).disabled).toBe(true);
    const search = screen.getByLabelText("搜尋代碼或名稱");
    await userEvent.clear(search);
    await userEvent.type(search, "中砂");
    expect(screen.getAllByText("中砂二").length).toBeGreaterThan(0);
    expect(screen.queryByText("台泥一永")).toBeNull();
    expect(document.body.textContent).not.toContain("73.29");
    expect(document.body.textContent).not.toContain("cbDayQry");
  });

  it("opens the detail view without treating the issuance price as effective", async () => {
    window.location.hash = "#/bond/11011";
    render(<App initialSnapshot={snapshot} />);
    expect(screen.getByRole("heading", { name: /台泥一永/ })).toBeTruthy();
    expect(screen.getAllByText("目前生效轉換價").length).toBeGreaterThan(0);
    expect(screen.getAllByText("未取得").length).toBeGreaterThan(3);
    expect(screen.getByText("36.5")).toBeTruthy();
    expect(screen.getByText("26.75")).toBeTruthy();
    expect(document.body.textContent).toContain("不會把發行價標成目前生效");
    expect(document.body.textContent).toContain("2026-09");
  });
});
