// Transistor types

export interface TransistorShow {
  id: string;
  type: string;
  attributes: {
    title: string;
    description: string;
    author: string;
    image_url: string;
    created_at: string;
    updated_at: string;
  };
}

export interface TransistorEpisode {
  id: string;
  type: string;
  attributes: {
    title: string;
    summary: string;
    published_at: string;
    duration: number;
    number: number;
    status: string;
    share_url: string;
    media_url: string;
    image_url: string;
    formatted_published_at: string;
  };
}

export interface TransistorAnalyticsPoint {
  date: string;
  downloads: number;
}

export interface TransistorAnalyticsResponse {
  data: {
    id: string;
    type: string;
    attributes: {
      downloads: TransistorAnalyticsPoint[];
      start_date: string;
      end_date: string;
    };
  };
}

export interface TransistorCountryData {
  country: string;
  downloads: number;
}

export interface TransistorAppData {
  app: string;
  downloads: number;
}

export interface TransistorDeviceData {
  device: string;
  downloads: number;
  percentage: number;
}

// YouTube types

export interface YouTubeChannelStats {
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
}

export interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
  duration: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

export interface YouTubeAnalyticsPoint {
  date: string;
  views: number;
  estimatedMinutesWatched: number;
  subscribersGained: number;
  subscribersLost: number;
}

export interface YouTubeTrafficSource {
  source: string;
  views: number;
  estimatedMinutesWatched: number;
}

export interface YouTubeCountryData {
  country: string;
  views: number;
  estimatedMinutesWatched: number;
}

export interface YouTubeDemographic {
  ageGroup: string;
  gender: string;
  viewerPercentage: number;
}

export interface YouTubeSubscriptionStatus {
  status: string;
  views: number;
  estimatedMinutesWatched: number;
}

export interface YouTubeDeviceType {
  deviceType: string;
  views: number;
  estimatedMinutesWatched: number;
}

export interface YouTubeContentType {
  contentType: string;
  views: number;
  estimatedMinutesWatched: number;
}

// Shared types

export interface DateRange {
  from: string;
  to: string;
}

export type DateRangePreset = "7d" | "30d" | "90d" | "12m" | "custom";

export interface AccessibleShow {
  wpShowId: number;
  title: string;
}
