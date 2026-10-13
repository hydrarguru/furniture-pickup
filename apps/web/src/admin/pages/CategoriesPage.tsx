import type { AdminCategory } from "@hamtning/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { Navigate } from "react-router";
import { ApiError } from "../../lib/api.js";
import { adminApi } from "../api.js";
import { keys, useCategories, useMe } from "../queries.js";

const errorText = (err: unknown) =>
  err instanceof ApiError && err.code === "duplicate_label"
    ? "Det finns redan en kategori med det namnet."
    : "Ändringen kunde inte sparas.";

export function CategoriesPage() {
  const me = useMe();
  const categories = useCategories();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.categories });

  const create = useMutation({
    mutationFn: (v: { label: string; sortOrder: number }) =>
      adminApi.createCategory(v.label, v.sortOrder),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: (v: { id: number; patch: Partial<Omit<AdminCategory, "id">> }) =>
      adminApi.updateCategory(v.id, v.patch),
    onSuccess: refresh,
  });

  if (me.data?.role !== "admin") return <Navigate to="/admin" replace />;

  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const label = String(data.get("label")).trim();
    if (!label) return;
    create.mutate(
      { label, sortOrder: Number(data.get("sortOrder") || 0) },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <>
      <h1>Kategorier</h1>
      <p className="muted">
        Visas som val i formuläret. Inaktiva kategorier döljs i formuläret men finns kvar på äldre
        ärenden. Lägre sorteringsnummer visas först.
      </p>

      {categories.isPending ? (
        <p className="muted">Laddar…</p>
      ) : categories.data?.length === 0 ? (
        <p className="empty">Inga kategorier ännu. Formuläret visar då ingen kategorilista.</p>
      ) : (
        <table className="category-table">
          <thead>
            <tr>
              <th scope="col">Namn</th>
              <th scope="col">Sortering</th>
              <th scope="col">Aktiv</th>
            </tr>
          </thead>
          <tbody>
            {categories.data?.map((c) => (
              <tr key={c.id} className={c.active ? "" : "inactive"}>
                <td>
                  <input
                    aria-label={`Namn för ${c.labelSv}`}
                    defaultValue={c.labelSv}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== c.labelSv) update.mutate({ id: c.id, patch: { labelSv: v } });
                      else e.target.value = c.labelSv;
                    }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="short"
                    aria-label={`Sortering för ${c.labelSv}`}
                    defaultValue={c.sortOrder}
                    min={0}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isInteger(v) && v >= 0 && v !== c.sortOrder)
                        update.mutate({ id: c.id, patch: { sortOrder: v } });
                    }}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${c.labelSv} aktiv`}
                    checked={c.active}
                    onChange={(e) =>
                      update.mutate({ id: c.id, patch: { active: e.target.checked } })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {update.isError && (
        <p className="banner" role="alert">
          {errorText(update.error)}
        </p>
      )}

      <h2>Ny kategori</h2>
      <form onSubmit={add} className="row category-add">
        <div className="field">
          <label htmlFor="new-label">Namn</label>
          <input id="new-label" name="label" required maxLength={60} />
        </div>
        <div className="field">
          <label htmlFor="new-sort">Sortering</label>
          <input
            id="new-sort"
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={0}
            className="short"
          />
        </div>
        <div className="field add-button">
          <button type="submit" disabled={create.isPending}>
            Lägg till
          </button>
        </div>
      </form>
      {create.isError && (
        <p className="banner" role="alert">
          {errorText(create.error)}
        </p>
      )}
    </>
  );
}
