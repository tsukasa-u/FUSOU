"""
fusou_datasets._exceptions
~~~~~~~~~~~~~~~~~~~~~~~~~~

Custom exception hierarchy for fusou-datasets.
"""

class FusouDatasetsError(Exception):
    """Base exception for all fusou-datasets errors."""
    pass


class AuthenticationError(FusouDatasetsError):
    """Raised when API key is missing or invalid."""
    pass


class DeviceUnverifiedError(FusouDatasetsError):
    """Raised when device requires verification."""
    pass


class DatasetNotFoundError(FusouDatasetsError):
    """Raised when a requested table or dataset cannot be found."""
    pass


class VerificationError(FusouDatasetsError):
    """Raised when device verification fails."""
    pass


class RateLimitError(FusouDatasetsError):
    """Raised when API rate limit (RU limit) is exceeded."""
    def __init__(self, message: str, retry_after: int = 1):
        super().__init__(message)
        self.retry_after = retry_after


class DownloadError(FusouDatasetsError):
    """Raised when downloading a dataset partition fails."""
    pass