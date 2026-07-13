import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiResponseDto<T> {
  @ApiProperty()
  success!: boolean;

  @ApiProperty()
  statusCode!: number;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  data!: T;

  @ApiPropertyOptional()
  errors?: { message: string }[];

  @ApiProperty()
  timestamp!: string;

  @ApiProperty()
  path!: string;
}
