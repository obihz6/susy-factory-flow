"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type Version = { id: string; gtnhVersion: string; channel: string; publishedAt: string; local?: boolean; recipeCount?: number };
type RecipeRow = { recipe: Recipe; source: "published" | "local-version" | "custom" };
type Ingredient = { item: string; amount: number; isFluid: boolean };
type Output = Ingredient & { probability: number };
type Recipe = {
  id: string;
  name: string;
  displayName?: string;
  machineType: string;
  durationTicks: number;
  eut: number;
  inputs: Array<{ id: string; amount: number; kind: string }>;
  outputs: Array<{ id: string; amount: number; chance?: number; kind: string }>;
  source?: { datasetVersionId?: string };
  metadata?: { customRecipeId?: string; tags?: string[]; [key: string]: unknown };
};

type Draft = {
  id?: string;
  internalName: string;
  displayName: string;
  sourceVersion: string;
  machine: string;
  duration: number;
  EUt: number;
  inputs: Ingredient[];
  outputs: Output[];
  parallel: boolean;
  cleanroom: boolean;
  voltageTier: string;
  notes: string;
  tags: string;
  baseRecipe?: { versionId: string; recipeId: string } | null;
};

const blankDraft = (sourceVersion = "local-dev"): Draft => ({
  internalName: "",
  displayName: "",
  sourceVersion,
  machine: "Furnace",
  duration: 20,
  EUt: 0,
  inputs: [{ item: "", amount: 1, isFluid: false }],
  outputs: [{ item: "", amount: 1, isFluid: false, probability: 100 }],
  parallel: false,
  cleanroom: false,
  voltageTier: "LV",
  notes: "",
  tags: "",
});

export default function RecipeEditorPage() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionId, setVersionId] = useState("all");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [draft, setDraft] = useState<Draft>(() => blankDraft());
  const [editingId, setEditingId] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/versions").then((response) => response.json()).then((data) => setVersions(data.versions ?? [])).catch((error) => setMessage(String(error)));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (versionId !== "all") params.set("versionId", versionId);
    if (query.trim()) params.set("query", query.trim());
    void fetch(`/api/recipes?${params}`).then((response) => response.json()).then((data) => setRows(data.recipes ?? [])).catch((error) => setMessage(String(error)));
  }, [query, versionId]);

  const selectedVersion = useMemo(() => versions.find((version) => version.id === versionId), [versionId, versions]);
  const localVersions = versions.filter((version) => version.local);

  function editRecipe(row: RecipeRow) {
    const recipe = row.recipe;
    const customId = recipe.metadata?.customRecipeId;
    if (!customId) {
      setMessage("Published recipes are read-only; save a copy as a custom recipe instead.");
      setDraft({
        ...blankDraft(versionId === "all" ? "local-dev" : versionId),
        internalName: recipe.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
        displayName: recipe.name,
        machine: recipe.machineType,
        duration: recipe.durationTicks,
        EUt: recipe.eut,
        inputs: recipe.inputs.map((input) => ({ item: input.id, amount: input.amount, isFluid: input.kind === "fluid" })),
        outputs: recipe.outputs.map((output) => ({ item: output.id, amount: output.amount, isFluid: output.kind === "fluid", probability: (output.chance ?? 1) * 100 })),
        baseRecipe: { versionId: recipe.source?.datasetVersionId ?? versionId, recipeId: recipe.id },
      });
      setEditingId(undefined);
      return;
    }
    void fetch(`/api/recipes/${customId}`).then((response) => response.json()).then((data) => {
      const custom = data.recipe;
      setDraft({
        id: custom.id,
        internalName: custom.internalName,
        displayName: custom.displayName,
        sourceVersion: custom.sourceVersion,
        machine: custom.machine,
        duration: custom.duration,
        EUt: custom.EUt,
        inputs: custom.inputs,
        outputs: custom.outputs,
        parallel: custom.properties.parallel,
        cleanroom: custom.properties.cleanroom,
        voltageTier: custom.properties.voltageTier,
        notes: custom.notes,
        tags: custom.tags.join(", "),
        baseRecipe: custom.baseRecipe,
      });
      setEditingId(custom.id);
    }).catch((error) => setMessage(String(error)));
  }

  async function saveRecipe(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const payload = {
      ...(draft.id ? { id: draft.id } : {}),
      internalName: draft.internalName,
      displayName: draft.displayName,
      source: "local-dev",
      sourceVersion: draft.sourceVersion || "local-dev",
      machine: draft.machine,
      duration: Number(draft.duration),
      EUt: Number(draft.EUt),
      inputs: draft.inputs,
      outputs: draft.outputs,
      properties: { parallel: draft.parallel, cleanroom: draft.cleanroom, voltageTier: draft.voltageTier },
      notes: draft.notes,
      tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      baseRecipe: draft.baseRecipe ?? null,
    };
    try {
      const response = await fetch(draft.id ? `/api/recipes/${draft.id}` : "/api/recipes", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error((data.errors ?? [data.error]).join(" "));
      setMessage(data.warnings?.join(" ") || "Recipe saved locally.");
      setDraft(blankDraft(versionId === "all" ? "local-dev" : versionId));
      setEditingId(undefined);
      await reloadRecipes();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function reloadRecipes() {
    const params = new URLSearchParams();
    if (versionId !== "all") params.set("versionId", versionId);
    if (query.trim()) params.set("query", query.trim());
    const response = await fetch(`/api/recipes?${params}`);
    const data = await response.json();
    setRows(data.recipes ?? []);
  }

  async function deleteRecipe(id: string) {
    if (!window.confirm("Soft-delete this custom recipe? It will remain in history.")) return;
    const response = await fetch(`/api/recipes/${id}`, { method: "DELETE" });
    if (!response.ok) setMessage((await response.json()).error ?? "Delete failed.");
    else await reloadRecipes();
  }

  function updateIngredient(kind: "inputs" | "outputs", index: number, key: string, value: string | number | boolean) {
    setDraft((current) => ({ ...current, [kind]: current[kind].map((entry, entryIndex) => entryIndex === index ? { ...entry, [key]: value } : entry) }));
  }

  return (
    <main className="min-h-screen bg-[#17191d] px-4 py-8 text-[#eee4d0] sm:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs uppercase tracking-[0.25em] text-[#9c8b72]">Supersymmetry</p><h1 className="text-3xl font-bold">Recipe workshop</h1><p className="mt-1 text-sm text-[#b8ab99]">Published recipes stay read-only. Local changes are saved as custom recipes.</p></div>
          <Link className="rounded border border-[#665b4d] px-3 py-2 text-sm hover:bg-[#29251f]" href="/">Back to planner</Link>
        </header>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="rounded border border-[#4d463d] bg-[#202329] p-4">
            <div className="mb-4 flex flex-wrap gap-3">
              <select className="rounded bg-[#17191d] px-3 py-2" value={versionId} onChange={(event) => setVersionId(event.target.value)}><option value="all">All versions</option>{versions.map((version) => <option key={version.id} value={version.id}>{version.gtnhVersion}{version.local ? " (local)" : ""}</option>)}</select>
              <input className="min-w-48 flex-1 rounded bg-[#17191d] px-3 py-2" placeholder="Search recipe, machine, item..." value={query} onChange={(event) => setQuery(event.target.value)} />
              <Link className="rounded border border-[#665b4d] px-3 py-2 text-sm" href="/api/recipes/export">Export custom</Link>
            </div>
            {selectedVersion?.local && <p className="mb-3 text-xs text-[#b8ab99]">Local version: {selectedVersion.id} · {selectedVersion.recipeCount ?? 0} recipes</p>}
            <div className="space-y-2">{rows.map((row) => <article key={`${row.source}-${row.recipe.id}`} className="rounded border border-[#3b3d42] bg-[#191b20] p-3"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{row.recipe.name}</h2><p className="text-xs text-[#b8ab99]">{row.recipe.machineType} · {row.recipe.durationTicks} ticks · {row.recipe.eut} EU/t · {row.source}</p><p className="mt-1 text-xs text-[#9c8b72]">{row.recipe.inputs.map((input) => `${input.amount} ${input.id}`).join(", ")} → {row.recipe.outputs.map((output) => `${output.amount} ${output.id}`).join(", ")}</p></div>{row.source === "custom" && <div className="flex gap-2"><button className="text-xs text-[#9ecbff]" onClick={() => editRecipe(row)}>Edit</button><button className="text-xs text-[#ff9f9f]" onClick={() => void deleteRecipe(row.recipe.metadata?.customRecipeId ?? row.recipe.id)}>Delete</button></div>}</div></article>)}</div>
            {rows.length === 0 && <p className="py-10 text-center text-sm text-[#9c8b72]">No recipes match this filter.</p>}
          </section>
          <form className="space-y-4 rounded border border-[#4d463d] bg-[#202329] p-4" onSubmit={saveRecipe}><div className="flex items-center justify-between"><h2 className="text-xl font-bold">{editingId ? "Edit custom recipe" : "Create recipe"}</h2><button type="button" className="text-xs text-[#b8ab99]" onClick={() => { setDraft(blankDraft(versionId === "all" ? "local-dev" : versionId)); setEditingId(undefined); }}>Clear</button></div>
            <label className="block text-sm">Internal name<input required className="mt-1 w-full rounded bg-[#17191d] px-3 py-2" value={draft.internalName} onChange={(event) => setDraft({ ...draft, internalName: event.target.value })} /></label>
            <label className="block text-sm">Display name<input required className="mt-1 w-full rounded bg-[#17191d] px-3 py-2" value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
            <div className="grid grid-cols-2 gap-3"><label className="text-sm">Machine<input required list="recipe-machines" className="mt-1 w-full rounded bg-[#17191d] px-3 py-2" value={draft.machine} onChange={(event) => setDraft({ ...draft, machine: event.target.value })} /><datalist id="recipe-machines"><option value="Furnace" /><option value="Assembly Line" /><option value="Chemical Reactor" /><option value="Alloy Smelter" /><option value="Macerator" /><option value="Canner" /></datalist></label><label className="text-sm">Version<select className="mt-1 w-full rounded bg-[#17191d] px-3 py-2" value={draft.sourceVersion} onChange={(event) => setDraft({ ...draft, sourceVersion: event.target.value })}><option value="local-dev">local-dev</option>{localVersions.map((version) => <option key={version.id} value={version.id}>{version.gtnhVersion}</option>)}</select></label></div>
            <div className="grid grid-cols-3 gap-3"><label className="text-sm">Ticks<input required min="1" type="number" className="mt-1 w-full rounded bg-[#17191d] px-3 py-2" value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: Number(event.target.value) })} /></label><label className="text-sm">EU/t<input min="0" type="number" className="mt-1 w-full rounded bg-[#17191d] px-3 py-2" value={draft.EUt} onChange={(event) => setDraft({ ...draft, EUt: Number(event.target.value) })} /></label><label className="text-sm">Tier<select className="mt-1 w-full rounded bg-[#17191d] px-3 py-2" value={draft.voltageTier} onChange={(event) => setDraft({ ...draft, voltageTier: event.target.value })}>{["ULV", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV"].map((tier) => <option key={tier}>{tier}</option>)}</select></label></div>
            <ResourceEditor title="Inputs" entries={draft.inputs} onChange={(index, key, value) => updateIngredient("inputs", index, key, value)} onAdd={() => setDraft({ ...draft, inputs: [...draft.inputs, { item: "", amount: 1, isFluid: false }] })} onRemove={(index) => setDraft({ ...draft, inputs: draft.inputs.filter((_, entryIndex) => entryIndex !== index) })} />
            <ResourceEditor title="Outputs" entries={draft.outputs} onChange={(index, key, value) => updateIngredient("outputs", index, key, value)} onAdd={() => setDraft({ ...draft, outputs: [...draft.outputs, { item: "", amount: 1, isFluid: false, probability: 100 }] })} onRemove={(index) => setDraft({ ...draft, outputs: draft.outputs.filter((_, entryIndex) => entryIndex !== index) })} outputs />
            <div className="flex flex-wrap gap-4 text-sm"><label><input type="checkbox" checked={draft.parallel} onChange={(event) => setDraft({ ...draft, parallel: event.target.checked })} /> Parallel</label><label><input type="checkbox" checked={draft.cleanroom} onChange={(event) => setDraft({ ...draft, cleanroom: event.target.checked })} /> Cleanroom</label></div>
            <label className="block text-sm">Tags<input className="mt-1 w-full rounded bg-[#17191d] px-3 py-2" placeholder="experimental, steam-age" value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></label><label className="block text-sm">Notes<textarea className="mt-1 min-h-20 w-full rounded bg-[#17191d] px-3 py-2" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
            {message && <p className="rounded bg-[#302a20] p-2 text-sm text-[#f2cf8c]">{message}</p>}<button disabled={busy} className="w-full rounded bg-[#b77938] px-4 py-3 font-bold text-[#17191d] disabled:opacity-50" type="submit">{busy ? "Saving..." : "Save locally"}</button>
          </form>
        </div>
      </div>
    </main>
  );
}

function ResourceEditor({ title, entries, onChange, onAdd, onRemove, outputs = false }: { title: string; entries: Array<Ingredient | Output>; onChange: (index: number, key: string, value: string | number | boolean) => void; onAdd: () => void; onRemove: (index: number) => void; outputs?: boolean }) {
  return <section><div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">{title}</h3><button type="button" className="text-xs text-[#9ecbff]" onClick={onAdd}>+ Add</button></div><div className="space-y-2">{entries.map((entry, index) => <div className="grid grid-cols-[1fr_70px_auto_auto] items-center gap-2" key={index}><input required className="min-w-0 rounded bg-[#17191d] px-2 py-2 text-sm" placeholder="item or fluid id" value={entry.item} onChange={(event) => onChange(index, "item", event.target.value)} /><input required min="0.000001" type="number" className="rounded bg-[#17191d] px-2 py-2 text-sm" value={entry.amount} onChange={(event) => onChange(index, "amount", Number(event.target.value))} /><label className="text-xs"><input type="checkbox" checked={entry.isFluid} onChange={(event) => onChange(index, "isFluid", event.target.checked)} /> fluid</label>{outputs ? <input min="0" max="100" type="number" className="w-14 rounded bg-[#17191d] px-1 py-2 text-xs" title="Probability %" value={(entry as Output).probability} onChange={(event) => onChange(index, "probability", Number(event.target.value))} /> : <span />}{entries.length > 1 && <button type="button" className="text-xs text-[#ff9f9f]" onClick={() => onRemove(index)}>×</button>}</div>)}</div></section>;
}
