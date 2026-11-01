export type OrderedItem = { id: string };

export function reorderItemsById<T extends OrderedItem>(
  items: T[],
  sourceId: string,
  targetId: string,
): T[] {
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items;
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function moveItemById<T extends OrderedItem>(
  items: T[],
  id: string,
  direction: -1 | 1,
  belongsToGroup: (item: T) => boolean = () => true,
): T[] {
  const source = items.find((item) => item.id === id);
  if (!source || !belongsToGroup(source)) return items;
  const group = items.filter(belongsToGroup);
  const sourceIndex = group.findIndex((item) => item.id === id);
  const target = group[sourceIndex + direction];
  return target ? reorderItemsById(items, id, target.id) : items;
}
