import { NotificationType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { EnumOut } from '@/common/http/decorators';
import { PageMetaDto, PaginationQueryDto } from '@/common/http/pagination.dto';

export class NotificationDto {
  id: string;
  @EnumOut(NotificationType, 'NotificationType') type: NotificationType;
  title: string;
  body: string;
  /** In-app link target. */
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export class NotificationListDto {
  items: NotificationDto[];
  meta: PageMetaDto;
  unreadCount: number;
}

export class NotificationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unreadOnly?: boolean;
}

export class UnreadCountDto {
  count: number;
}
