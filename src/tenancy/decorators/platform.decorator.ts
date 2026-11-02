import { SetMetadata } from '@nestjs/common';
import { PlatformKey } from '../tenancy.constants';

export const PLATFORM_KEY = 'platform';

// The route only works when the company has this platform enabled.
// Needs @CompanyAuth() on the route.
export const Platform = (platform: PlatformKey) =>
  SetMetadata(PLATFORM_KEY, platform);
