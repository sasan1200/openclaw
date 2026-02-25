import { fetchDiscord } from "./api.js";
import { listGuilds, type DiscordGuildSummary } from "./guilds.js";
import { normalizeDiscordSlug } from "./monitor/allow-list.js";
import { normalizeDiscordToken } from "./token.js";

type DiscordChannelSummary = {
  id: string;
  name: string;
  guildId: string;
  type?: number;
  archived?: boolean;
};

type DiscordChannelPayload = {
  id?: string;
  name?: string;
  type?: number;
  guild_id?: string;
  thread_metadata?: { archived?: boolean };
};

export type DiscordChannelResolution = {
  input: string;
  resolved: boolean;
  guildId?: string;
  guildName?: string;
  channelId?: string;
  channelName?: string;
  archived?: boolean;
  note?: string;
};

function parseDiscordChannelInput(raw: string): {
  guild?: string;
  channel?: string;
  channelId?: string;
  guildId?: string;
  guildOnly?: boolean;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  const mention = trimmed.match(/^<#(\d+)>$/);
  if (mention) {
    return { channelId: mention[1] };
  }
  const channelPrefix = trimmed.match(/^(?:channel:|discord:)?(\d+)$/i);
  if (channelPrefix) {
    return { channelId: channelPrefix[1] };
  }
  const guildPrefix = trimmed.match(/^(?:guild:|server:)?(\d+)$/i);
  if (guildPrefix && !trimmed.includes("/") && !trimmed.includes("#")) {
    return { guildId: guildPrefix[1], guildOnly: true };
  }
  const split = trimmed.includes("/") ? trimmed.split("/") : trimmed.split("#");
  if (split.length >= 2) {
    const guild = split[0]?.trim();
    const channel = split.slice(1).join("#").trim();
    if (!channel) {
      return guild ? { guild: guild.trim(), guildOnly: true } : {};
    }
    if (guild && /^\d+$/.test(guild)) {
      return { guildId: guild, channel };
    }
    return { guild, channel };
  }
  return { guild: trimmed, guildOnly: true };
}

async function listGuildChannels(
  token: string,
  fetcher: typeof fetch,
  guildId: string,
): Promise<DiscordChannelSummary[]> {
  const raw = await fetchDiscord<DiscordChannelPayload[]>(
    `/guilds/${guildId}/channels`,
    token,
    fetcher,
  );
  return raw
    .map((channel) => {
      const archived = channel.thread_metadata?.archived;
      return {
        id: typeof channel.id === "string" ? channel.id : "",
        name: typeof channel.name === "string" ? channel.name : "",
        guildId,
        type: channel.type,
        archived,
      };
    })
    .filter((channel) => Boolean(channel.id) && Boolean(channel.name));
}

async function fetchChannel(
  token: string,
  fetcher: typeof fetch,
  channelId: string,
): Promise<DiscordChannelSummary | null> {
  const raw = await fetchDiscord<DiscordChannelPayload>(`/channels/${channelId}`, token, fetcher);
  if (!raw || typeof raw.guild_id !== "string" || typeof raw.id !== "string") {
    return null;
  }
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : "",
    guildId: raw.guild_id,
    type: raw.type,
  };
}

function preferActiveMatch(candidates: DiscordChannelSummary[]): DiscordChannelSummary | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  const scored = candidates.map((channel) => {
    const isThread = channel.type === 11 || channel.type === 12;
    const archived = Boolean(channel.archived);
    const score = (archived ? 0 : 2) + (isThread ? 0 : 1);
    return { channel, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.channel ?? candidates[0];
}

function resolveGuildByName(
  guilds: DiscordGuildSummary[],
  input: string,
): DiscordGuildSummary | undefined {
  const slug = normalizeDiscordSlug(input);
  if (!slug) {
    return undefined;
  }
  return guilds.find((guild) => guild.slug === slug);
}

export async function resolveDiscordChannelAllowlist(params: {
  token: string;
  entries: string[];
  fetcher?: typeof fetch;
}): Promise<DiscordChannelResolution[]> {
  const token = normalizeDiscordToken(params.token);
  if (!token) {
    return params.entries.map((input) => ({
      input,
      resolved: false,
    }));
  }
  const fetcher = params.fetcher ?? fetch;
  const guilds = await listGuilds(token, fetcher);
  // #region agent log
  fetch("http://127.0.0.1:7275/ingest/fb78f46b-94bc-40ef-93b8-80066baaa7f3", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5ae62d" },
    body: JSON.stringify({
      sessionId: "5ae62d",
      location: "resolve-channels.ts:listGuilds",
      message: "listGuilds result",
      data: {
        guildCount: guilds.length,
        guildSlugs: guilds.map((g) => g.slug),
        guildNames: guilds.map((g) => g.name),
      },
      timestamp: Date.now(),
      hypothesisId: "H1_H2",
    }),
  }).catch(() => {});
  // #endregion
  const channelsByGuild = new Map<string, Promise<DiscordChannelSummary[]>>();
  const getChannels = (guildId: string) => {
    const existing = channelsByGuild.get(guildId);
    if (existing) {
      return existing;
    }
    const promise = listGuildChannels(token, fetcher, guildId);
    channelsByGuild.set(guildId, promise);
    return promise;
  };

  const results: DiscordChannelResolution[] = [];

  for (const input of params.entries) {
    const parsed = parseDiscordChannelInput(input);
    if (parsed.guildOnly) {
      const guild =
        parsed.guildId && guilds.find((entry) => entry.id === parsed.guildId)
          ? guilds.find((entry) => entry.id === parsed.guildId)
          : parsed.guild
            ? resolveGuildByName(guilds, parsed.guild)
            : undefined;
      if (guild) {
        results.push({
          input,
          resolved: true,
          guildId: guild.id,
          guildName: guild.name,
        });
      } else {
        results.push({
          input,
          resolved: false,
          guildId: parsed.guildId,
          guildName: parsed.guild,
        });
      }
      continue;
    }

    if (parsed.channelId) {
      const channel = await fetchChannel(token, fetcher, parsed.channelId);
      if (channel?.guildId) {
        const guild = guilds.find((entry) => entry.id === channel.guildId);
        results.push({
          input,
          resolved: true,
          guildId: channel.guildId,
          guildName: guild?.name,
          channelId: channel.id,
          channelName: channel.name,
          archived: channel.archived,
        });
      } else {
        results.push({
          input,
          resolved: false,
          channelId: parsed.channelId,
        });
      }
      continue;
    }

    if (parsed.guildId || parsed.guild) {
      const guild =
        parsed.guildId && guilds.find((entry) => entry.id === parsed.guildId)
          ? guilds.find((entry) => entry.id === parsed.guildId)
          : parsed.guild
            ? resolveGuildByName(guilds, parsed.guild)
            : undefined;
      const channelQuery = parsed.channel?.trim();
      // #region agent log
      fetch("http://127.0.0.1:7275/ingest/fb78f46b-94bc-40ef-93b8-80066baaa7f3", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5ae62d" },
        body: JSON.stringify({
          sessionId: "5ae62d",
          location: "resolve-channels.ts:guild+channel",
          message: "guild+channel resolution step",
          data: {
            input,
            parsedGuild: parsed.guild,
            parsedGuildId: parsed.guildId,
            channelQuery,
            guildFound: !!guild,
            matchedGuildSlug: guild?.slug,
          },
          timestamp: Date.now(),
          hypothesisId: "H1_H5",
        }),
      }).catch(() => {});
      // #endregion
      if (!guild || !channelQuery) {
        // #region agent log
        fetch("http://127.0.0.1:7275/ingest/fb78f46b-94bc-40ef-93b8-80066baaa7f3", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5ae62d" },
          body: JSON.stringify({
            sessionId: "5ae62d",
            location: "resolve-channels.ts:unresolvedNoGuild",
            message: "guild not found or no channel query",
            data: { input, guildFound: !!guild, channelQuery: channelQuery ?? null },
            timestamp: Date.now(),
            hypothesisId: "H1_H2_H5",
          }),
        }).catch(() => {});
        // #endregion
        results.push({
          input,
          resolved: false,
          guildId: parsed.guildId,
          guildName: parsed.guild,
          channelName: channelQuery ?? parsed.channel,
        });
        continue;
      }
      const channels = await getChannels(guild.id);
      // #region agent log
      const channelSlugs = channels.map((c) => normalizeDiscordSlug(c.name));
      fetch("http://127.0.0.1:7275/ingest/fb78f46b-94bc-40ef-93b8-80066baaa7f3", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5ae62d" },
        body: JSON.stringify({
          sessionId: "5ae62d",
          location: "resolve-channels.ts:channelsInGuild",
          message: "channels in guild",
          data: {
            input,
            guildId: guild.id,
            channelCount: channels.length,
            channelSlugs,
            querySlug: normalizeDiscordSlug(channelQuery),
          },
          timestamp: Date.now(),
          hypothesisId: "H3_H4",
        }),
      }).catch(() => {});
      // #endregion
      const matches = channels.filter(
        (channel) => normalizeDiscordSlug(channel.name) === normalizeDiscordSlug(channelQuery),
      );
      const match = preferActiveMatch(matches);
      if (match) {
        results.push({
          input,
          resolved: true,
          guildId: guild.id,
          guildName: guild.name,
          channelId: match.id,
          channelName: match.name,
          archived: match.archived,
        });
      } else {
        // #region agent log
        fetch("http://127.0.0.1:7275/ingest/fb78f46b-94bc-40ef-93b8-80066baaa7f3", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5ae62d" },
          body: JSON.stringify({
            sessionId: "5ae62d",
            location: "resolve-channels.ts:unresolvedChannel",
            message: "channel not found in guild",
            data: { input, guildName: guild.name, channelQuery: parsed.channel },
            timestamp: Date.now(),
            hypothesisId: "H3",
          }),
        }).catch(() => {});
        // #endregion
        results.push({
          input,
          resolved: false,
          guildId: guild.id,
          guildName: guild.name,
          channelName: parsed.channel,
          note: `channel not found in guild ${guild.name}`,
        });
      }
      continue;
    }

    const channelName = input.trim().replace(/^#/, "");
    if (!channelName) {
      results.push({
        input,
        resolved: false,
        channelName: channelName,
      });
      continue;
    }
    const candidates: DiscordChannelSummary[] = [];
    for (const guild of guilds) {
      const channels = await getChannels(guild.id);
      for (const channel of channels) {
        if (normalizeDiscordSlug(channel.name) === normalizeDiscordSlug(channelName)) {
          candidates.push(channel);
        }
      }
    }
    const match = preferActiveMatch(candidates);
    if (match) {
      const guild = guilds.find((entry) => entry.id === match.guildId);
      results.push({
        input,
        resolved: true,
        guildId: match.guildId,
        guildName: guild?.name,
        channelId: match.id,
        channelName: match.name,
        archived: match.archived,
        note:
          candidates.length > 1 && guild?.name
            ? `matched multiple; chose ${guild.name}`
            : undefined,
      });
      continue;
    }

    results.push({
      input,
      resolved: false,
      channelName: channelName,
    });
  }

  return results;
}
