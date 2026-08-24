// Preset system for Etch tools: a named-preset dropdown + Restart + Randomize,
// plus JSON import/export. Presets and files both operate on the plain `params`
// object (which Tweakpane bindings mutate directly), so the on-disk format is
// simply the params JSON. Call pane.refresh() after mutating params externally.
export function attachPresets(page, { pane, params, presets = {}, onApply, randomize }) {
  const names = Object.keys(presets);
  const state = { preset: names[0] || 'Custom' };

  function apply(name) {
    const preset = presets[name];
    if (!preset) return;
    Object.assign(params, preset);
    pane.refresh();
    onApply?.();
  }

  if (names.length) {
    const options = { Custom: 'Custom' };
    for (const n of names) options[n] = n;
    page.addBinding(state, 'preset', { label: 'Preset', options })
      .on('change', (ev) => { if (ev.value !== 'Custom') apply(ev.value); });
    page.addButton({ title: 'Restart Preset' })
      .on('click', () => apply(state.preset));
  }

  if (randomize) {
    page.addButton({ title: 'Randomize' }).on('click', () => {
      randomize(params);
      state.preset = 'Custom';
      pane.refresh();
      onApply?.();
    });
  }

  page.addBlade({ view: 'separator' });

  page.addButton({ title: 'Export Preset (.json)' }).on('click', () => {
    const blob = new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.download = 'preset.json';
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  page.addButton({ title: 'Import Preset (.json)' }).on('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          Object.assign(params, JSON.parse(reader.result));
          state.preset = 'Custom';
          pane.refresh();
          onApply?.();
        } catch (err) {
          console.error('Invalid preset file', err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });

  return { apply };
}
