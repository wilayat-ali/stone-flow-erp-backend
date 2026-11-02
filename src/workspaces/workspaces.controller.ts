import {
  Controller,
  Get,
  NotFoundException,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { WorkspaceVerifyQueryDto } from './dto/workspace-verify-query.dto';
import { WorkspaceVerifyResponseDto } from './dto/workspace-verify-response.dto';
import { CompaniesService } from '../companies/companies.service';

@ApiTags('Workspaces')
@Controller({
  path: 'workspaces',
  version: '1',
})
export class WorkspacesController {
  constructor(private readonly companiesService: CompaniesService) {}

  // Public: lets the login page confirm a workspace exists before asking for
  // credentials. Reveals only the name and status.
  @Get('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WorkspaceVerifyResponseDto })
  async verify(
    @Query() query: WorkspaceVerifyQueryDto,
  ): Promise<WorkspaceVerifyResponseDto> {
    const company = await this.companiesService.findBySlug(query.slug);

    if (!company) {
      throw new NotFoundException();
    }

    return { name: company.name, status: company.status };
  }
}
