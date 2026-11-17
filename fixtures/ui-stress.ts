/** Generated only by the standalone ?demo=stress preview. No repository or Figma access. */
export function uiStressFixture() {
  const tokens = Object.fromEntries(
    Array.from({ length: 5000 }, (_, index) => {
      const path = `token${String(index).padStart(4, '0')}${index === 0 ? '.a-deliberately-long-token-name-for-overflow-review' : ''}`;
      const type = index % 4;
      return [
        path,
        type === 0
          ? { type: 'color', value: '#5265ed80' }
          : type === 1
            ? { type: 'number', value: index + 0.000001 }
            : type === 2
              ? { type: 'boolean', value: index % 3 === 0 }
              : {
                  type: 'string',
                  value: 'A longer string value to inspect in the expanded row details.',
                },
      ];
    }),
  );
  return {
    stress: tokens,
    $themes: ['Light', 'Dark', 'Contrast', 'Dim', 'Warm', 'Cool'].map((name) => ({
      id: name.toLowerCase(),
      name,
      group: 'Stress collection',
      selectedTokenSets: { stress: 'enabled' },
    })),
    $metadata: { tokenSetOrder: ['stress'] },
  };
}
