export const NAVBAR_ID = "1e81e15b58074facba4b51c5a47e23da";
export const FOOTER_ID = "9a987904c1c24ddfbb686033426a224a";

export function commentThreads() {
  return { map: 1 };
}

export function sectionReference(id) {
  return { id, commentThreads: commentThreads(), type: "reference" };
}

export function sectionValue(name, description) {
  return {
    value: {
      name,
      description,
      element: {},
      aiReason: "",
      currentShuffleIndex: 0,
      isComponentOutOfSync: false,
    },
    commentThreads: commentThreads(),
    type: "inline",
  };
}

export function countRelumePages(page) {
  return 1 + (page.subPages ?? []).reduce((total, subPage) => total + countRelumePages(subPage), 0);
}

export function escapeHtmlAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function globalSections(siteName = "") {
  return {
    [NAVBAR_ID]: {
      name: "Navbar",
      description: siteName ? `${siteName} global navigation.` : "Global navigation.",
      element: {},
      aiReason: "",
      currentShuffleIndex: 0,
      isComponentOutOfSync: false,
    },
    [FOOTER_ID]: {
      name: "Footer",
      description: siteName ? `${siteName} global footer.` : "Global footer.",
      element: {},
      aiReason: "",
      currentShuffleIndex: 0,
      isComponentOutOfSync: false,
    },
  };
}

export function decodedPayloadFromHtml(html) {
  const match = html.match(/data-blocks-payload-v1="([^"]+)"/);
  if (!match) throw new Error("No data-blocks-payload-v1 attribute found.");
  const json = match[1]
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return JSON.parse(json);
}

export function validatePayloadHtml(html) {
  const payload = decodedPayloadFromHtml(html);
  if (payload.type !== "page") throw new Error(`Expected payload.type page, got ${payload.type}`);
  if (!payload.state?.name) throw new Error("Payload missing state.name");
  const count = countRelumePages(payload.state);
  if (count < 1) throw new Error("Payload has no pages");
  if (!payload.globalSections?.[NAVBAR_ID] || !payload.globalSections?.[FOOTER_ID]) {
    throw new Error("Payload missing Navbar/Footer global sections");
  }
  return { count, rootName: payload.state.name };
}
