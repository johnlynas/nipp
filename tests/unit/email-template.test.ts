/**
 * Unit tests for lib/notifications/email.ts — the branded Property NI template.
 *
 * Pins the two layout behaviours that matter for multi-line bodies:
 * 1. Plain-text messages are escaped and rendered as real paragraphs with <br>
 *    line breaks (without this, HTML collapses every \n and the work order RFQ
 *    ships as one run-on paragraph — the wall-of-text bug).
 * 2. Authored HTML (the OIDC invitation's styled button) passes through verbatim.
 */

import { describe, it, expect } from 'vitest';
import { createEmailTemplate, renderBodyForTemplate, escapeHtml } from '@/lib/notifications/email';

const RFQ_BODY = [
  'Dear Sarah,',
  '',
  'Fairview Housing Association would like to request your quotation for the following work:',
  '',
  'Work order reference: wo-1',
  'Description: Replace lift door interlock, basement level 2',
  'Quotation due: 2026-10-24',
  'Contact point: Fairview Housing Association — orders@example.com',
  '',
  'To proceed, please reply with your total amount and a brief breakdown of the quoted price, by the due date above.',
  'If you are unable to submit a quotation for this work, a short reply letting us know is appreciated.',
  '',
  'Regards',
  'Fairview Housing Association',
].join('\n');

describe('renderBodyForTemplate', () => {
  it('splits plain text blocks into <p> paragraphs and line breaks into <br>', () => {
    const html = renderBodyForTemplate(RFQ_BODY);
    // Blank-line separated blocks → separate paragraphs (greeting, request line, fields, action lines, sign-off).
    expect((html.match(/<p /g) ?? []).length).toBe(5);
    // Fields live on their own lines inside one block.
    expect(html).toContain('<br>');
    expect(html.indexOf('Work order reference: wo-1<br>Description:')).not.toBe(-1);
  });

  it(`escapes HTML in plain text so field values can't inject markup (e.g. "A & B <Ltd>")`, () => {
    const html = renderBodyForTemplate('Description: A & B <Ltd>');
    expect(html).toContain('A &amp; B &lt;Ltd&gt;');
    expect(html).not.toContain('&lt;/p&gt;&lt;script');
  });

  it('passes authored HTML through verbatim (OIDC invitation keeps its button)', () => {
    const authored = '\n    <p>Hi John,</p>\n    <p style="margin: 24px 0;">\n      <a href="/auth/magic-link/verify?token=tok"\n         style="display: inline-block; background-color: #1B2A4A;">Activate my account</a>\n    </p>';
    expect(renderBodyForTemplate(authored)).toBe(authored);
  });

  it('trims surrounding blank lines from plain text', () => {
    const html = renderBodyForTemplate('\n\nJust one line.\n\n');
    expect(html).not.toContain('<br>');
    expect((html.match(/<p /g) ?? []).length).toBe(1);
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`& < > "`)).toBe('&amp; &lt; &gt; &quot;');
  });
});

describe('createEmailTemplate', () => {
  it('renders the branded shell — header strip, amber accent and automated footer', () => {
    const { html } = createEmailTemplate('Quotation request — wo-1 from Fairview Housing Association', RFQ_BODY, 'Property NI — Quotation Request');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Property NI — Quotation Request');
    expect(html).toContain('background-color: #F5A623;'); // amber accent bar
    expect(html).toContain('This is an automated notification from Property NI');
  });

  it('keeps the plain-text fallback for clients that strip HTML', () => {
    const { text } = createEmailTemplate('Subject line', RFQ_BODY);
    expect(text.startsWith('Subject line\n\n')).toBe(true);
    expect(text).toContain('Work order reference: wo-1');
  });

  it('renders a multi-line work order body as distinct lines in the HTML (the layout bug regression)', () => {
    const { html } = createEmailTemplate('Quotation request', RFQ_BODY, 'Property NI — Quotation Request');
    // Every field lands on its own line (<br>), not one collapsed run-on paragraph.
    expect(html).toContain('Work order reference: wo-1<br>Description: Replace lift door interlock, basement level 2<br>Quotation due: 2026-10-24<br>Contact point: Fairview Housing Association — orders@example.com');
  });
});
