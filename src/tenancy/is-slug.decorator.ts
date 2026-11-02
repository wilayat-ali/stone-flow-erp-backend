import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidSlug } from './slug';

export function IsSlug(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isSlug',
      target: object.constructor,
      propertyName,
      options: {
        message:
          'slug must be 3-40 characters of a-z, 0-9 and hyphen (not starting or ending with a hyphen) and not a reserved word',
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) => isValidSlug(value),
      },
    });
  };
}
