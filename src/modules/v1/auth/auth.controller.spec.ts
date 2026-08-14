import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserRole } from '../../../common/enums/user-role.enum';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<Partial<AuthService>>;

  const mockSafeUser = {
    id: 'user-uuid',
    email: 'manager@horizonpm.com',
    fullName: 'Test Manager',
    role: UserRole.MANAGER,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      getProfile: jest.fn(),
      changePassword: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('should return tokens and user on success', async () => {
      const result = { accessToken: 'at', refreshToken: 'rt', user: mockSafeUser };
      (authService.login as jest.Mock).mockResolvedValue(result);

      const response = await controller.login({
        email: 'manager@horizonpm.com',
        password: 'SecurePass123!',
      });

      expect(response).toEqual(result);
      expect(authService.login).toHaveBeenCalledWith({
        email: 'manager@horizonpm.com',
        password: 'SecurePass123!',
      });
    });
  });

  describe('refresh', () => {
    it('should return new tokens', async () => {
      const result = { accessToken: 'new-at', refreshToken: 'new-rt' };
      (authService.refresh as jest.Mock).mockResolvedValue(result);

      const response = await controller.refresh('user-uuid', 'session-uuid');
      expect(response).toEqual(result);
      expect(authService.refresh).toHaveBeenCalledWith('user-uuid', 'session-uuid');
    });
  });

  describe('logout', () => {
    it('should end only the session it was called from', async () => {
      (authService.logout as jest.Mock).mockResolvedValue(undefined);
      const result = await controller.logout('user-uuid', 'session-uuid');
      expect(result).toEqual({ message: 'Logged out successfully' });
      expect(authService.logout).toHaveBeenCalledWith('user-uuid', 'session-uuid');
    });
  });

  describe('getProfile', () => {
    it('should return current user profile', async () => {
      (authService.getProfile as jest.Mock).mockResolvedValue(mockSafeUser);
      const result = await controller.getProfile('user-uuid');
      expect(result).toEqual(mockSafeUser);
    });
  });

  describe('changePassword', () => {
    it('should return success message', async () => {
      (authService.changePassword as jest.Mock).mockResolvedValue(undefined);
      const result = await controller.changePassword('user-uuid', {
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass123!',
      });
      expect(result).toEqual({ message: 'Password changed successfully' });
    });
  });
});
