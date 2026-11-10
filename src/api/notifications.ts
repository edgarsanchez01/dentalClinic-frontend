import { apiFetch } from './http';
import type { PageDto } from './patients';

export type NotificationPriority = 'NORMAL' | 'HIGH';

export interface NotificationDto {
  id: number;
  title: string;
  body: string;
  priority: NotificationPriority;
  read: boolean;
  createdAt: string;
  appointmentId?: number;
  relatedType?: string;
  relatedId?: number;
  readAt?: string;
}

export interface UnreadCountDto {
  unread: number;
}

export interface NotificationListParams {
  page?: number;
  size?: number;
}

export const notificationsApi = {
  list({ page = 0, size = 20 }: NotificationListParams = {}): Promise<PageDto<NotificationDto>> {
    const search = new URLSearchParams({ page: String(page), size: String(size) });
    return apiFetch<PageDto<NotificationDto>>(`/api/notifications?${search}`);
  },

  unreadCount(): Promise<UnreadCountDto> {
    return apiFetch<UnreadCountDto>('/api/notifications/unread-count');
  },

  markRead(id: number): Promise<NotificationDto> {
    return apiFetch<NotificationDto>(`/api/notifications/${id}/read`, { method: 'POST' });
  },
};
