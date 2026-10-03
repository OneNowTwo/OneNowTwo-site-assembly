"use client";

import { useState } from "react";
import { ASSUMPTION_META, type Assumptions } from "@/lib/analysis/assumptions";
import { Badge, Button, Field, NumberField, Panel, Select } from "@/components/ui";

const ENUM_OPTIONS: Partial<Record<keyof Assumptions, { value: string; label: string }[]>> = {
  targetBasis: [
    { value: "COST", label: "Margin on cost" },
    { value: "REVENUE", label: "Margin on revenue" },
  ],
  revenueMode: [
    { value: "UNIT_MIX", label: "Unit mix (recommended)" },
    { value: "PER_SQM", label: "$/sqm saleable" },
    { value: "PER_DWELLING", label: "$ per dwelling" },
  ],
};

export function AssumptionsForm({ initial, defaults }: { initial: Assumptions; defaults: Assumptions }) {
  const [values, setValues] = useState<Assumptions>(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const groups = [...new Set(Object.values(ASSUMPTION_META).map((m) => m.group))];
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const { fetchApiJson } = await import("@/lib/api-json");
      await fetchApiJson("/api/assumptions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      setStatus("Saved. Opportunities without overrides have been recalculated.");
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-[19px] font-semibold">Global assumptions</h1>
          <p className="text-[12px] text-muted">Defaults applied to every opportunity unless overridden on that opportunity. These are assumptions, not market data.</p>
        </div>
        <div className="flex items-center gap-2">
          {status && <span className="text-[12px] text-muted">{status}</span>}
          <Button onClick={() => setValues(defaults)}>Reset to defaults</Button>
          <Button variant="primary" disabled={saving || !dirty} onClick={save}>
            {saving ? "Saving…" : "Save assumptions"}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        {groups.map((g) => (
          <Panel key={g} title={g} actions={<Badge tone="assumption">Assumption</Badge>}>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(ASSUMPTION_META) as (keyof Assumptions)[])
                .filter((k) => ASSUMPTION_META[k].group === g)
                .map((k) => {
                  const meta = ASSUMPTION_META[k];
                  const v = values[k];
                  return (
                    <Field key={k} label={meta.label} hint={meta.help}>
                      {meta.unit === "enum" ? (
                        <Select value={v as string} onChange={(nv) => setValues({ ...values, [k]: nv })} options={ENUM_OPTIONS[k] ?? []} className="w-full" />
                      ) : (
                        <NumberField
                          kind={meta.unit === "pct" ? "pct" : meta.unit === "money" || meta.unit === "moneyPerSqm" ? "money" : "number"}
                          suffix={meta.unit === "sqm" ? "sqm" : meta.unit === "m" ? "m" : meta.unit === "ratio" ? "" : undefined}
                          value={v as number}
                          allowEmpty={false}
                          onCommit={(nv) => nv != null && setValues({ ...values, [k]: meta.unit === "count" ? Math.round(nv) : nv })}
                        />
                      )}
                    </Field>
                  );
                })}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
