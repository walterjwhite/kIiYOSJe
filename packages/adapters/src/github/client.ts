/**
 * GitHub REST client — just the calls this adapter needs.
 *
 * Auth is a fine-grained PAT with read access to metadata and pull requests.
 * Token comes from the `github:` section of credentials.yml, or GITHUB_TOKEN.
 */

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  draft?: boolean | undefined;
  created_at: string;
  updated_at: string;
  /** https://api.github.com/repos/<owner>/<name> */
  repository_url: string;
  user: { login: string } | null;
  labels: Array<{ name: string }>;
}

interface SearchResponse {
  total_count: number;
  items: GitHubPullRequest[];
}

export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl = "https://api.github.com",
  ) {}

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mind-attention-manager",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new Error(`github: ${path} returned ${response.status}`);
    }
    return (await response.json()) as T;
  }

  /** Search needs a literal login — unlike some REST endpoints, `@me` is not accepted. */
  whoami(): Promise<{ login: string }> {
    return this.request<{ login: string }>("/user");
  }

  searchPullRequests(query: string, perPage = 30): Promise<GitHubPullRequest[]> {
    const q = encodeURIComponent(query);
    return this.request<SearchResponse>(
      `/search/issues?q=${q}&per_page=${perPage}&sort=updated&order=desc`,
    ).then((response) => response.items ?? []);
  }
}
