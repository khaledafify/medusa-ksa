import { createHash } from "node:crypto";

import { DOMParser, type Node } from "@xmldom/xmldom";
import { XmlCanonicalizer } from "xmldsigjs";

/**
 * Invoice-hash pipeline (ZATCA Security Features Implementation Standards
 * §2.3.3, verified against the SDK validator — see test/fixtures/sdk):
 *
 * 1. Remove `Invoice/ext:UBLExtensions`, `Invoice/cac:Signature`, and the
 *    QR `cac:AdditionalDocumentReference` (the SDK's removal leaves the
 *    surrounding whitespace text nodes in place — so does this).
 * 2. Canonicalize (C14N, no comments).
 * 3. SHA-256 → base64 of the raw digest.
 *
 * The result must byte-match the SDK's `fatoora -generateHash` output for
 * the same document (proven by the golden-sample test, ADR-0007).
 */

/** Direct children of `Invoice` removed before hashing. */
function isQrDocumentReference(node: Node): boolean {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && child.nodeName === "cbc:ID") {
      return child.textContent?.trim() === "QR";
    }
  }
  return false;
}

/**
 * Strip the signature-related elements and canonicalize — the exact byte
 * stream ZATCA hashes (and the byte-match surface for builder tests).
 */
export function canonicalizeForHashing(invoiceXml: string): string {
  const doc = new DOMParser().parseFromString(invoiceXml, "text/xml");
  const root = doc.documentElement;
  if (root?.nodeName !== "Invoice") {
    throw new Error("expected an <Invoice> root element");
  }

  const toRemove: Node[] = [];
  for (let node: Node | null = root.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue;
    const name = node.nodeName;
    if (
      name === "ext:UBLExtensions" ||
      name === "cac:Signature" ||
      (name === "cac:AdditionalDocumentReference" && isQrDocumentReference(node))
    ) {
      toRemove.push(node);
    }
  }
  for (const node of toRemove) {
    root.removeChild(node);
  }

  const canonicalizer = new XmlCanonicalizer(false, false);
  // @xmldom/xmldom nodes are structurally compatible with the DOM interface
  // xmldsigjs expects (same usage as the adapted wes4m/zatca-xml-js).
  return canonicalizer.Canonicalize(doc);
}

/** SHA-256 over the canonicalized invoice, base64 of the raw digest (KSA-13 format). */
export function computeInvoiceHash(invoiceXml: string): string {
  return createHash("sha256")
    .update(canonicalizeForHashing(invoiceXml))
    .digest("base64");
}
