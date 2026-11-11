// Only JSON data crosses from the engine into labels, hooks and saved logs.
export function attackRef(attack) {
  return { $attack: { sourceCardId: attack.sourceCardId, name: attack.name } };
}

export function powerRef(power) {
  return { $power: { sourceCardId: power.sourceCardId, name: power.name } };
}
