import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfirmDialog } from '../src/components/common/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders a destructive confirmation with cancel focused by default', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        open
        title="Delete 42A?"
        confirmLabel="Delete shot"
        destructive
        onCancel={() => undefined}
        onConfirm={() => undefined}
      >
        Saved captures will be removed from this project. This cannot be undone.
      </ConfirmDialog>,
    );

    expect(html).toContain('data-confirm-dialog');
    expect(html).toContain('Delete 42A?');
    expect(html).toContain('Delete shot');
    expect(html).toContain('bg-red-600');
    expect(html).toContain('Cancel');
  });
});
