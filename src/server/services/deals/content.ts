// The blocks a written proposal or agreement is made of. Safe to import in the browser.
export type BlockType = 'h1' | 'h2' | 'p' | 'bullets' | 'numbered' | 'table' | 'pagebreak';
export type Block = { id: string; type: BlockType; text: string };

export const BLOCK_LABELS: Record<BlockType, string> = {
  h1: 'Heading',
  h2: 'Sub-heading',
  p: 'Paragraph',
  bullets: 'Bullet points',
  numbered: 'Numbered points',
  table: 'Table',
  pagebreak: 'Page break',
};

export const BLOCK_HELP: Record<BlockType, string> = {
  h1: 'e.g. 1. Parties',
  h2: 'e.g. 2.1 Delivery timeline',
  p: 'Write the paragraph.',
  bullets: 'One point per line.',
  numbered: 'One point per line. They are numbered for you.',
  table: 'One row per line, columns separated by " | ". The first line is the header.',
  pagebreak: '',
};

const id = () => Math.random().toString(36).slice(2, 10);
const block = (type: BlockType, text = ''): Block => ({ id: id(), type, text });

// A starting point to edit, not finished legal text. Everything in it can be changed or removed.
export function starterBlocks(kind: 'proposal' | 'agreement'): Block[] {
  if (kind === 'proposal') {
    return [
      block('h1', '1. Executive brief'),
      block('p', 'Describe in a few lines what the client gets and why it matters to their business.'),
      block('h1', '2. Scope of work'),
      block('bullets', 'First deliverable\nSecond deliverable\nThird deliverable'),
      block('h1', '3. Timeline'),
      block('table', 'Time window | Primary work | Checkpoint\nWeek 1 | Discovery and planning | Signed requirements\nWeek 2 | Build begins | First demo'),
      block('h1', '4. What is included and what is not'),
      block('p', 'List the boundaries of the fixed price, such as third-party costs the client pays for.'),
      block('h1', '5. Terms'),
      block('numbered', 'Work begins after written acceptance and the first milestone payment.\nMilestone invoices are payable within three working days of the trigger.\nSource code transfers to the client after full payment and handover.'),
    ];
  }
  return [
    block('h1', '1. Parties'),
    block('p', 'This Agreement is entered into between Shotlin Digital Product Studio ("Developer") and the Client named on the first page.'),
    block('h1', '2. Project purpose and delivery model'),
    block('p', 'Describe the product being built and how it will be delivered.'),
    block('h2', '2.1 Delivery timeline'),
    block('p', 'State the delivery period, when it starts, and what can extend it.'),
    block('h1', '3. Deliverables'),
    block('bullets', 'Customer application\nAdmin dashboard\nShared backend and database'),
    block('h1', '4. Third-party services, accounts and charges'),
    block('p', 'Production accounts should be owned by the Client. Hosting, domains, messaging, payment-gateway and store fees are paid by the Client.'),
    block('h1', '5. Source code, ownership and handover'),
    block('p', 'After full payment and final acceptance, the Client receives the project-specific source code. Pre-existing tools and reusable libraries remain with the Developer.'),
    block('h1', '6. UAT, acceptance and change control'),
    block('p', 'The Client gives written acceptance or one consolidated defect report within 10 working days of delivery. New work is chargeable only after it is agreed in writing.'),
    block('h1', '7. Warranty and support'),
    block('p', 'Six months of defect support for the delivered scope, counted from production go-live.'),
    block('h1', '8. Client responsibilities'),
    block('bullets', 'Provide brand assets, content and required access on time\nGive consolidated feedback and approvals\nOperate the product after launch'),
    block('h1', '9. Confidentiality, liability and disputes'),
    block('p', 'Each party keeps the other\'s non-public information confidential. Liability is limited to the amount paid under this Agreement. Disputes are resolved by written negotiation and then arbitration in Kolkata, West Bengal.'),
  ];
}

// The final document is deliberately separate from the commercial agreement. It records
// what was handed over and gives the client a clear, auditable acceptance action.
export function completionBlocks(input: { projectTitle: string; clientName: string; brief: string; deliverables: string[] }) : Block[] {
  const delivered = input.deliverables.filter(Boolean);
  return [
    block('h1', 'Project completion and delivery acceptance'),
    block('p', `This Delivery Acceptance Record confirms the completion and handover of “${input.projectTitle}” by Shotlin Digital Product Studio to ${input.clientName || 'the Client'}. It is read together with the project agreement and records final client acceptance of the delivered work.`),
    block('h1', '1. Delivery summary'),
    block('p', input.brief || 'The agreed project scope, configuration, documentation and handover materials have been completed and made available to the Client.'),
    block('h1', '2. Items delivered'),
    block('bullets', delivered.length ? delivered.join('\n') : 'Completed project deliverables\nProduction handover and access details\nProject documentation and final walkthrough'),
    block('h1', '3. Client acceptance'),
    block('p', 'By signing this record, the Client confirms that it has received the deliverables listed above, has had a reasonable opportunity to review them, and accepts the completed work as delivered. Any agreed post-delivery support continues only under the original agreement or a separately agreed support arrangement.'),
    block('h1', '4. Handover and responsibilities'),
    block('bullets', 'The Client confirms receipt of the relevant access, files and handover information.\nThe Client is responsible for protecting its own passwords, domains, third-party accounts and production data after handover.\nAny new scope, enhancement or change after this acceptance is handled as a new written request.'),
    block('h1', '5. Final record'),
    block('p', 'This digitally signed record becomes the final completion record for the project. The signed PDF is locked, retained with the project and cannot be changed without creating a new document.'),
  ];
}
