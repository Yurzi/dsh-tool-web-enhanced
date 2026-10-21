/** Anthropic Web search tool documentation, response example (2026-10-21). */
export const anthropicSearchResponse = {
  role: 'assistant',
  content: [
    { type: 'text', text: "I'll search for when Claude Shannon was born." },
    { type: 'server_tool_use', id: 'srvtoolu_01WYG3ziw53XMcoyKL4XcZmE', name: 'web_search', input: { query: 'claude shannon birth date' } },
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_01WYG3ziw53XMcoyKL4XcZmE', content: [
      { type: 'web_search_result', url: 'https://en.wikipedia.org/wiki/Claude_Shannon', title: 'Claude Shannon - Wikipedia', encrypted_content: 'EqgfCioIARgBIiQ3YTAwMjY1Mi1mZjM5LTQ1NGUtODgxNC1kNjNjNTk1ZWI3Y...', page_age: 'April 30, 2025' },
    ] },
    { text: 'Based on the search results, ', type: 'text' },
    { text: 'Claude Shannon was born on April 30, 1916, in Petoskey, Michigan', type: 'text', citations: [
      { type: 'web_search_result_location', url: 'https://en.wikipedia.org/wiki/Claude_Shannon', title: 'Claude Shannon - Wikipedia', encrypted_index: 'Eo8BCioIAhgBIiQyYjQ0OWJmZi1lNm..', cited_text: 'Claude Elwood Shannon (April 30, 1916 – February 24, 2001) was an American mathematician, electrical engineer, computer scientist, cryptographer and i...' },
    ] },
  ],
}
