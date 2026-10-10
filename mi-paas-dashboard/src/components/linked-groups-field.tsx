"use client";

export function LinkedGroupsField({
  groups,
  selected,
  onChange,
}: {
  groups: Array<{ id: string; name: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-xs font-medium text-slate-700">Linked Environment Groups</legend>
      {groups.length === 0 ? (
        <p className="text-[11px] text-slate-500">
          No hay grupos. Se crean en Environment Groups.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {groups.map((group) => {
            const checked = selected.includes(group.id);
            return (
              <label key={group.id} className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  className="size-3.5 accent-sky-700"
                  checked={checked}
                  onChange={() =>
                    onChange(
                      checked
                        ? selected.filter((id) => id !== group.id)
                        : [...selected, group.id],
                    )
                  }
                />
                <span className="font-mono">{group.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
