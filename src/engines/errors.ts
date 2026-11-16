import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

// Same shape as the rest of the API: 422 with { errors: { field: 'code' } }.
export function invalid(errors: Record<string, string>) {
  return new UnprocessableEntityException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    errors,
  });
}

// A rule of the business was broken (not a malformed request): 409 + a stable
// machine-readable code the UI can translate.
export function conflict(code: string, details: Record<string, unknown> = {}) {
  return new ConflictException({
    status: HttpStatus.CONFLICT,
    code,
    ...details,
  });
}

// Another company's id must look exactly like an id that does not exist.
export function notFound(field: string) {
  return new NotFoundException({
    status: HttpStatus.NOT_FOUND,
    errors: { [field]: 'notFound' },
  });
}

export function forbidden(code: string) {
  return new ForbiddenException({
    status: HttpStatus.FORBIDDEN,
    code,
  });
}
