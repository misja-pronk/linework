// Text and attribute values for SVG, XML and HTML: the one escape every writer shares, so none
// forgets a character. All five, so a value is safe in a double- or single-quoted attribute too.
export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
