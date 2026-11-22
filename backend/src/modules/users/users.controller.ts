import { Body, Controller, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@/common/http/decorators';
import {
  AvailabilityRuleOutDto,
  CategoryDto,
  PreferenceDto,
  ReplaceAvailabilityDto,
  UpdatePreferenceDto,
  UpdateProfileDto,
  UserDto,
} from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiCookieAuth()
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users/me')
  @ApiOperation({ summary: 'Current user profile' })
  me(@CurrentUser() user: AuthUser): Promise<UserDto> {
    return this.users.getUser(user.id);
  }

  @Patch('users/me')
  @ApiOperation({ summary: 'Update profile' })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<UserDto> {
    return this.users.updateProfile(user.id, dto.displayName);
  }

  @Get('users/me/preferences')
  @ApiOperation({ summary: 'Timezone, locale, scheduling and notification preferences' })
  preferences(@CurrentUser() user: AuthUser): Promise<PreferenceDto> {
    return this.users.getPreference(user.id);
  }

  @Patch('users/me/preferences')
  @ApiOperation({ summary: 'Update preferences' })
  updatePreferences(@CurrentUser() user: AuthUser, @Body() dto: UpdatePreferenceDto): Promise<PreferenceDto> {
    return this.users.updatePreference(user.id, dto);
  }

  @Post('users/me/onboarding/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark onboarding as completed' })
  completeOnboarding(@CurrentUser() user: AuthUser): Promise<PreferenceDto> {
    return this.users.completeOnboarding(user.id);
  }

  @Get('users/me/availability')
  @ApiOperation({ summary: 'Weekly availability rules declared by the user' })
  availability(@CurrentUser() user: AuthUser): Promise<AvailabilityRuleOutDto[]> {
    return this.users.listAvailability(user.id);
  }

  @Put('users/me/availability')
  @ApiOperation({ summary: 'Replace all weekly availability rules' })
  replaceAvailability(@CurrentUser() user: AuthUser, @Body() dto: ReplaceAvailabilityDto): Promise<AvailabilityRuleOutDto[]> {
    return this.users.replaceAvailability(user.id, dto.rules);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Activity categories' })
  categories(@CurrentUser() user: AuthUser): Promise<CategoryDto[]> {
    return this.users.listCategories(user.id);
  }
}
