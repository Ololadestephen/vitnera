// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC3643TokenLike, IERC3643IdentityRegistryLike } from "./interfaces/IERC3643Minimal.sol";

contract VitneraRWA is EIP712, Ownable2Step, ReentrancyGuard {
    using ECDSA for bytes32;

    uint256 public constant MAX_URI_BYTES = 240;
    uint64 public constant MIN_REQUEST_TTL = 10 minutes;
    uint64 public constant MAX_REQUEST_TTL = 30 days;

    bytes32 public constant AI_REVIEW_TYPEHASH = keccak256(
        "AIReviewAttestation(uint256 roomId,uint64 roomVersion,bytes32 documentRoot,bytes32 templateId,uint8 reviewStatus,bytes32 riskFlagsHash,bytes32 reportHash,uint32 policyVersion,uint256 nonce,uint64 expiry)"
    );
    bytes32 public constant VERIFIER_ATTESTATION_TYPEHASH = keccak256(
        "VerifierAttestation(uint256 roomId,uint64 roomVersion,bytes32 documentRoot,bytes32 findingsHash,uint256 nonce,uint64 expiry)"
    );

    enum RoomStatus {
        ReviewRequired,
        Active,
        Paused,
        Archived
    }

    enum ReviewStatus {
        None,
        ReviewReady,
        NeedsReview,
        Incomplete
    }

    enum RequestStatus {
        None,
        Pending,
        Approved,
        Rejected,
        Refunded,
        Revoked
    }

    struct DataRoom {
        address issuer;
        bytes32 metadataHash;
        string metadataUri;
        bytes32 documentRoot;
        bytes32 keyCommitment;
        bytes32 termsHash;
        bytes32 templateId;
        uint256 accessPrice;
        uint256 currentReviewId;
        uint64 version;
        uint64 requestTtl;
        uint64 createdAt;
        uint64 updatedAt;
        RoomStatus status;
        address regulatedToken;
    }

    struct AIReview {
        bytes32 documentRoot;
        bytes32 templateId;
        bytes32 riskFlagsHash;
        bytes32 reportHash;
        address reviewer;
        uint64 roomVersion;
        uint64 expiry;
        uint64 recordedAt;
        uint32 policyVersion;
        ReviewStatus status;
    }

    struct AIReviewAttestation {
        uint256 roomId;
        uint64 roomVersion;
        bytes32 documentRoot;
        bytes32 templateId;
        ReviewStatus reviewStatus;
        bytes32 riskFlagsHash;
        bytes32 reportHash;
        uint32 policyVersion;
        uint256 nonce;
        uint64 expiry;
    }

    struct AccessRequest {
        uint256 roomId;
        uint64 roomVersion;
        address investor;
        bytes32 encryptionPublicKey;
        uint256 amount;
        uint64 requestedAt;
        uint64 expiresAt;
        RequestStatus status;
        bytes32 envelopeHash;
        string envelopeUri;
    }

    struct VerifierAttestation {
        uint256 roomId;
        uint64 roomVersion;
        bytes32 documentRoot;
        bytes32 findingsHash;
        uint256 nonce;
        uint64 expiry;
    }

    struct VerifierRecord {
        address verifier;
        uint256 roomId;
        uint64 roomVersion;
        bytes32 documentRoot;
        bytes32 findingsHash;
        uint64 expiry;
        uint64 recordedAt;
    }

    uint256 public roomCount;
    uint256 public reviewCount;
    uint256 public requestCount;
    uint256 public verifierAttestationCount;
    uint256 public totalPendingEscrow;
    uint256 public totalClaimableEarnings;
    uint256 public totalClaimableRefunds;

    mapping(uint256 => DataRoom) private _rooms;
    mapping(uint256 => AIReview) private _reviews;
    mapping(uint256 => AccessRequest) private _requests;
    mapping(uint256 => mapping(uint64 => mapping(address => uint256))) public latestRequestId;
    mapping(address => bool) public authorizedReviewers;
    mapping(address => bool) public authorizedVerifiers;
    mapping(address => uint256) public reviewerNonces;
    mapping(address => uint256) public verifierNonces;
    mapping(uint256 => VerifierRecord) private _verifierRecords;
    mapping(uint256 => uint256) public latestVerifierAttestationId;
    mapping(uint256 => uint256) public acknowledgedReviewId;
    mapping(uint256 => bytes32) public reviewAcknowledgementHash;
    mapping(bytes32 => bool) public supportedTemplates;
    mapping(uint32 => bool) public supportedPolicyVersions;
    mapping(address => uint256) public claimableEarnings;
    mapping(address => uint256) public claimableRefunds;

    event ReviewerAuthorizationUpdated(address indexed reviewer, bool authorized);
    event VerifierAuthorizationUpdated(address indexed verifier, bool authorized);
    event TemplateSupportUpdated(bytes32 indexed templateId, bool supported);
    event PolicyVersionSupportUpdated(uint32 indexed policyVersion, bool supported);
    event DataRoomCreated(
        uint256 indexed roomId,
        address indexed issuer,
        bytes32 indexed templateId,
        bytes32 documentRoot,
        bytes32 metadataHash,
        string metadataUri,
        uint256 accessPrice,
        uint64 version
    );
    event DocumentRootUpdated(
        uint256 indexed roomId,
        uint64 indexed version,
        bytes32 documentRoot,
        bytes32 metadataHash,
        string metadataUri,
        bytes32 keyCommitment
    );
    event AIReviewRecorded(
        uint256 indexed reviewId,
        uint256 indexed roomId,
        address indexed reviewer,
        uint64 roomVersion,
        ReviewStatus status,
        bytes32 reportHash,
        uint64 expiry
    );
    event VerifierAttestationRecorded(
        uint256 indexed attestationId,
        uint256 indexed roomId,
        address indexed verifier,
        uint64 roomVersion,
        bytes32 findingsHash,
        uint64 expiry
    );
    event DataRoomActivated(uint256 indexed roomId, uint64 indexed version, uint256 indexed reviewId);
    event ReviewFindingsAcknowledged(
        uint256 indexed roomId, uint256 indexed reviewId, address indexed issuer, bytes32 acknowledgementHash
    );
    event DataRoomPaused(uint256 indexed roomId, uint64 indexed version);
    event DataRoomArchived(uint256 indexed roomId, uint64 indexed version);
    event AccessRequested(
        uint256 indexed requestId,
        uint256 indexed roomId,
        address indexed investor,
        uint64 roomVersion,
        uint256 amount,
        bytes32 encryptionPublicKey,
        uint64 expiresAt
    );
    event AccessApproved(
        uint256 indexed requestId,
        uint256 indexed roomId,
        address indexed investor,
        bytes32 envelopeHash,
        string envelopeUri
    );
    event AccessRejected(uint256 indexed requestId, uint256 indexed roomId, address indexed investor);
    event RequestRefunded(uint256 indexed requestId, uint256 indexed roomId, address indexed investor);
    event AccessRevoked(uint256 indexed requestId, uint256 indexed roomId, address indexed investor);
    event EarningsWithdrawn(address indexed issuer, uint256 amount);
    event RefundWithdrawn(address indexed investor, uint256 amount);
    /// @dev registry value is a historical snapshot taken at linking time; the
    ///      live registry is always re-resolved from the token for decisions.
    event RegulatedAssetLinked(uint256 indexed roomId, address indexed regulatedToken, address identityRegistry);

    error Unauthorized();
    error InvalidRoom();
    error InvalidRequest();
    error InvalidStatus();
    error InvalidConfiguration();
    error InvalidAttestation();
    error InvalidReview();
    error InvalidPayment();
    error InvalidPublicKey();
    error InvalidEnvelope();
    error RequestExpired();
    error RequestStillActive();
    error ExistingRequest();
    error NothingToWithdraw();
    error TransferFailed();
    error UnsupportedTemplate();
    error UnsupportedPolicyVersion();
    error InvalidRegulatedToken();
    error InvestorNotVerified();

    constructor(address initialOwner) EIP712("Vitnera RWA", "1") Ownable(initialOwner) {
        if (initialOwner == address(0)) revert InvalidConfiguration();
    }

    modifier onlyIssuer(uint256 roomId) {
        DataRoom storage room = _rooms[roomId];
        if (room.issuer == address(0)) revert InvalidRoom();
        if (room.issuer != msg.sender) revert Unauthorized();
        _;
    }

    function setAuthorizedReviewer(address reviewer, bool authorized) external onlyOwner {
        if (reviewer == address(0)) revert InvalidConfiguration();
        authorizedReviewers[reviewer] = authorized;
        emit ReviewerAuthorizationUpdated(reviewer, authorized);
    }

    function setAuthorizedVerifier(address verifier, bool authorized) external onlyOwner {
        if (verifier == address(0)) revert InvalidConfiguration();
        authorizedVerifiers[verifier] = authorized;
        emit VerifierAuthorizationUpdated(verifier, authorized);
    }

    function setSupportedTemplate(bytes32 templateId, bool supported) external onlyOwner {
        if (templateId == bytes32(0)) revert InvalidConfiguration();
        supportedTemplates[templateId] = supported;
        emit TemplateSupportUpdated(templateId, supported);
    }

    function setSupportedPolicyVersion(uint32 policyVersion, bool supported) external onlyOwner {
        if (policyVersion == 0) revert InvalidConfiguration();
        supportedPolicyVersions[policyVersion] = supported;
        emit PolicyVersionSupportUpdated(policyVersion, supported);
    }

    function createDataRoom(
        bytes32 metadataHash,
        string calldata metadataUri,
        bytes32 documentRoot,
        bytes32 keyCommitment,
        bytes32 termsHash,
        bytes32 templateId,
        uint256 accessPrice,
        uint64 requestTtl,
        address regulatedToken
    ) external returns (uint256 roomId) {
        if (
            metadataHash == bytes32(0) || bytes(metadataUri).length == 0
                || bytes(metadataUri).length > MAX_URI_BYTES || documentRoot == bytes32(0)
                || keyCommitment == bytes32(0) || termsHash == bytes32(0) || accessPrice == 0
        ) revert InvalidConfiguration();
        if (!supportedTemplates[templateId]) revert UnsupportedTemplate();
        if (requestTtl < MIN_REQUEST_TTL || requestTtl > MAX_REQUEST_TTL) revert InvalidConfiguration();

        // A nonzero token opts the room into ERC-3643 investor gating. The call
        // below proves interface compatibility only; legitimacy is not asserted.
        address linkedRegistry;
        if (regulatedToken != address(0)) {
            linkedRegistry = _resolveIdentityRegistry(regulatedToken);
        }

        roomId = ++roomCount;
        uint64 timestamp = uint64(block.timestamp);
        _rooms[roomId] = DataRoom({
            issuer: msg.sender,
            metadataHash: metadataHash,
            metadataUri: metadataUri,
            documentRoot: documentRoot,
            keyCommitment: keyCommitment,
            termsHash: termsHash,
            templateId: templateId,
            accessPrice: accessPrice,
            currentReviewId: 0,
            version: 1,
            requestTtl: requestTtl,
            createdAt: timestamp,
            updatedAt: timestamp,
            status: RoomStatus.ReviewRequired,
            regulatedToken: regulatedToken
        });

        emit DataRoomCreated(
            roomId, msg.sender, templateId, documentRoot, metadataHash, metadataUri, accessPrice, 1
        );
        if (regulatedToken != address(0)) {
            emit RegulatedAssetLinked(roomId, regulatedToken, linkedRegistry);
        }
    }

    function updateDocumentRoot(
        uint256 roomId,
        bytes32 newDocumentRoot,
        bytes32 newMetadataHash,
        string calldata newMetadataUri,
        bytes32 newKeyCommitment
    ) external onlyIssuer(roomId) {
        DataRoom storage room = _rooms[roomId];
        if (room.status == RoomStatus.Archived) revert InvalidStatus();
        if (
            newDocumentRoot == bytes32(0) || newMetadataHash == bytes32(0)
                || bytes(newMetadataUri).length == 0 || bytes(newMetadataUri).length > MAX_URI_BYTES
                || newKeyCommitment == bytes32(0) || newDocumentRoot == room.documentRoot
                || newKeyCommitment == room.keyCommitment
        ) revert InvalidConfiguration();

        room.documentRoot = newDocumentRoot;
        room.metadataHash = newMetadataHash;
        room.metadataUri = newMetadataUri;
        room.keyCommitment = newKeyCommitment;
        room.version += 1;
        room.currentReviewId = 0;
        room.status = RoomStatus.ReviewRequired;
        room.updatedAt = uint64(block.timestamp);

        emit DocumentRootUpdated(
            roomId, room.version, newDocumentRoot, newMetadataHash, newMetadataUri, newKeyCommitment
        );
    }

    function updateRoomTerms(
        uint256 roomId,
        bytes32 newTermsHash,
        uint256 newAccessPrice,
        uint64 newRequestTtl
    ) external onlyIssuer(roomId) {
        if (
            newTermsHash == bytes32(0) || newAccessPrice == 0 || newRequestTtl < MIN_REQUEST_TTL
                || newRequestTtl > MAX_REQUEST_TTL
        ) revert InvalidConfiguration();
        DataRoom storage room = _rooms[roomId];
        if (room.status == RoomStatus.Archived) revert InvalidStatus();
        room.termsHash = newTermsHash;
        room.accessPrice = newAccessPrice;
        room.requestTtl = newRequestTtl;
        room.updatedAt = uint64(block.timestamp);
    }

    function recordAIReview(AIReviewAttestation calldata attestation, bytes calldata signature)
        external
        returns (uint256 reviewId)
    {
        reviewId = _recordAIReview(attestation, signature);
    }

    function recordReviewAndActivate(AIReviewAttestation calldata attestation, bytes calldata signature)
        external
        onlyIssuer(attestation.roomId)
        returns (uint256 reviewId)
    {
        reviewId = _recordAIReview(attestation, signature);
        _activateDataRoom(attestation.roomId);
    }

    function activateDataRoom(uint256 roomId) external onlyIssuer(roomId) {
        _activateDataRoom(roomId);
    }

    function activateDataRoomWithAcknowledgement(uint256 roomId, bytes32 acknowledgementHash)
        external
        onlyIssuer(roomId)
    {
        if (acknowledgementHash == bytes32(0)) revert InvalidConfiguration();
        DataRoom storage room = _rooms[roomId];
        AIReview storage review = _reviews[room.currentReviewId];
        if (!_isCurrentReviewValid(room, review)) revert InvalidReview();
        acknowledgedReviewId[roomId] = room.currentReviewId;
        reviewAcknowledgementHash[roomId] = acknowledgementHash;
        emit ReviewFindingsAcknowledged(roomId, room.currentReviewId, msg.sender, acknowledgementHash);
        _activateDataRoom(roomId);
    }

    function _recordAIReview(AIReviewAttestation calldata attestation, bytes calldata signature)
        internal
        returns (uint256 reviewId)
    {
        DataRoom storage room = _rooms[attestation.roomId];
        if (room.issuer == address(0)) revert InvalidRoom();
        if (
            attestation.roomVersion != room.version || attestation.documentRoot != room.documentRoot
                || attestation.templateId != room.templateId || attestation.expiry <= block.timestamp
                || attestation.reviewStatus == ReviewStatus.None
        ) revert InvalidAttestation();
        if (!supportedTemplates[attestation.templateId]) revert UnsupportedTemplate();
        if (!supportedPolicyVersions[attestation.policyVersion]) revert UnsupportedPolicyVersion();

        bytes32 digest = hashReviewAttestation(attestation);
        address reviewer = digest.recover(signature);
        if (!authorizedReviewers[reviewer]) revert Unauthorized();
        if (attestation.nonce != reviewerNonces[reviewer]) revert InvalidAttestation();
        reviewerNonces[reviewer] += 1;

        reviewId = ++reviewCount;
        _reviews[reviewId] = AIReview({
            documentRoot: attestation.documentRoot,
            templateId: attestation.templateId,
            riskFlagsHash: attestation.riskFlagsHash,
            reportHash: attestation.reportHash,
            reviewer: reviewer,
            roomVersion: attestation.roomVersion,
            expiry: attestation.expiry,
            recordedAt: uint64(block.timestamp),
            policyVersion: attestation.policyVersion,
            status: attestation.reviewStatus
        });
        room.currentReviewId = reviewId;
        acknowledgedReviewId[attestation.roomId] = 0;
        reviewAcknowledgementHash[attestation.roomId] = bytes32(0);
        room.status = RoomStatus.ReviewRequired;
        room.updatedAt = uint64(block.timestamp);

        emit AIReviewRecorded(
            reviewId,
            attestation.roomId,
            reviewer,
            attestation.roomVersion,
            attestation.reviewStatus,
            attestation.reportHash,
            attestation.expiry
        );
    }

    function _activateDataRoom(uint256 roomId) internal {
        DataRoom storage room = _rooms[roomId];
        if (room.status == RoomStatus.Archived) revert InvalidStatus();
        AIReview storage review = _reviews[room.currentReviewId];
        if (!_isCurrentReviewAccepted(roomId, room, review)) revert InvalidReview();
        room.status = RoomStatus.Active;
        room.updatedAt = uint64(block.timestamp);
        emit DataRoomActivated(roomId, room.version, room.currentReviewId);
    }

    function recordVerifierAttestation(VerifierAttestation calldata attestation, bytes calldata signature)
        external
        returns (uint256 attestationId)
    {
        DataRoom storage room = _rooms[attestation.roomId];
        if (room.issuer == address(0)) revert InvalidRoom();
        if (
            attestation.roomVersion != room.version || attestation.documentRoot != room.documentRoot
                || attestation.findingsHash == bytes32(0) || attestation.expiry <= block.timestamp
        ) revert InvalidAttestation();
        address verifier = hashVerifierAttestation(attestation).recover(signature);
        if (!authorizedVerifiers[verifier]) revert Unauthorized();
        if (attestation.nonce != verifierNonces[verifier]) revert InvalidAttestation();
        verifierNonces[verifier] += 1;

        attestationId = ++verifierAttestationCount;
        _verifierRecords[attestationId] = VerifierRecord({
            verifier: verifier,
            roomId: attestation.roomId,
            roomVersion: attestation.roomVersion,
            documentRoot: attestation.documentRoot,
            findingsHash: attestation.findingsHash,
            expiry: attestation.expiry,
            recordedAt: uint64(block.timestamp)
        });
        latestVerifierAttestationId[attestation.roomId] = attestationId;
        emit VerifierAttestationRecorded(
            attestationId,
            attestation.roomId,
            verifier,
            attestation.roomVersion,
            attestation.findingsHash,
            attestation.expiry
        );
    }

    function pauseDataRoom(uint256 roomId) external onlyIssuer(roomId) {
        DataRoom storage room = _rooms[roomId];
        if (room.status != RoomStatus.Active) revert InvalidStatus();
        room.status = RoomStatus.Paused;
        room.updatedAt = uint64(block.timestamp);
        emit DataRoomPaused(roomId, room.version);
    }

    function archiveDataRoom(uint256 roomId) external onlyIssuer(roomId) {
        DataRoom storage room = _rooms[roomId];
        room.status = RoomStatus.Archived;
        room.updatedAt = uint64(block.timestamp);
        emit DataRoomArchived(roomId, room.version);
    }

    function requestAccess(uint256 roomId, bytes32 encryptionPublicKey)
        external
        payable
        returns (uint256 requestId)
    {
        DataRoom storage room = _rooms[roomId];
        if (room.issuer == address(0)) revert InvalidRoom();
        if (room.status != RoomStatus.Active) revert InvalidStatus();
        if (!_isCurrentReviewAccepted(roomId, room, _reviews[room.currentReviewId])) {
            revert InvalidReview();
        }
        if (encryptionPublicKey == bytes32(0)) revert InvalidPublicKey();
        if (msg.value != room.accessPrice) revert InvalidPayment();
        _requireVerifiedInvestor(room, msg.sender);

        uint256 previousId = latestRequestId[roomId][room.version][msg.sender];
        if (previousId != 0) {
            RequestStatus previousStatus = _requests[previousId].status;
            if (previousStatus == RequestStatus.Pending || previousStatus == RequestStatus.Approved) {
                revert ExistingRequest();
            }
        }

        requestId = ++requestCount;
        uint64 timestamp = uint64(block.timestamp);
        uint64 expiresAt = timestamp + room.requestTtl;
        _requests[requestId] = AccessRequest({
            roomId: roomId,
            roomVersion: room.version,
            investor: msg.sender,
            encryptionPublicKey: encryptionPublicKey,
            amount: msg.value,
            requestedAt: timestamp,
            expiresAt: expiresAt,
            status: RequestStatus.Pending,
            envelopeHash: bytes32(0),
            envelopeUri: ""
        });
        latestRequestId[roomId][room.version][msg.sender] = requestId;
        totalPendingEscrow += msg.value;

        emit AccessRequested(
            requestId, roomId, msg.sender, room.version, msg.value, encryptionPublicKey, expiresAt
        );
    }

    function approveAccess(uint256 requestId, bytes32 envelopeHash, string calldata envelopeUri) external {
        AccessRequest storage request = _requests[requestId];
        if (request.investor == address(0)) revert InvalidRequest();
        DataRoom storage room = _rooms[request.roomId];
        if (room.issuer != msg.sender) revert Unauthorized();
        if (request.status != RequestStatus.Pending) revert InvalidStatus();
        if (block.timestamp >= request.expiresAt) revert RequestExpired();
        if (request.roomVersion != room.version || room.status != RoomStatus.Active) {
            revert InvalidStatus();
        }
        if (
            envelopeHash == bytes32(0) || bytes(envelopeUri).length == 0
                || bytes(envelopeUri).length > MAX_URI_BYTES
        ) {
            revert InvalidEnvelope();
        }
        // Re-check at key release: an investor may lose verification between
        // deposit and approval. Reverting here keeps regulated rooms compliant;
        // the issuer's reject path refunds the deposit unconditionally.
        _requireVerifiedInvestor(room, request.investor);

        request.status = RequestStatus.Approved;
        request.envelopeHash = envelopeHash;
        request.envelopeUri = envelopeUri;
        totalPendingEscrow -= request.amount;
        totalClaimableEarnings += request.amount;
        claimableEarnings[room.issuer] += request.amount;

        emit AccessApproved(requestId, request.roomId, request.investor, envelopeHash, envelopeUri);
    }

    function rejectAccess(uint256 requestId) external {
        AccessRequest storage request = _requests[requestId];
        if (request.investor == address(0)) revert InvalidRequest();
        DataRoom storage room = _rooms[request.roomId];
        if (room.issuer != msg.sender) revert Unauthorized();
        if (request.status != RequestStatus.Pending) revert InvalidStatus();

        request.status = RequestStatus.Rejected;
        _creditRefund(request);
        emit AccessRejected(requestId, request.roomId, request.investor);
    }

    function refundExpiredRequest(uint256 requestId) external {
        AccessRequest storage request = _requests[requestId];
        if (request.investor == address(0)) revert InvalidRequest();
        if (request.investor != msg.sender) revert Unauthorized();
        if (request.status != RequestStatus.Pending) revert InvalidStatus();
        DataRoom storage room = _rooms[request.roomId];
        bool unavailable = request.roomVersion != room.version || room.status != RoomStatus.Active;
        if (block.timestamp < request.expiresAt && !unavailable) revert RequestStillActive();

        request.status = RequestStatus.Refunded;
        _creditRefund(request);
        emit RequestRefunded(requestId, request.roomId, request.investor);
    }

    function revokeAccess(uint256 requestId) external {
        AccessRequest storage request = _requests[requestId];
        if (request.investor == address(0)) revert InvalidRequest();
        DataRoom storage room = _rooms[request.roomId];
        if (room.issuer != msg.sender) revert Unauthorized();
        if (request.status != RequestStatus.Approved) revert InvalidStatus();
        request.status = RequestStatus.Revoked;
        emit AccessRevoked(requestId, request.roomId, request.investor);
    }

    function withdrawEarnings() external nonReentrant {
        uint256 amount = claimableEarnings[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        claimableEarnings[msg.sender] = 0;
        totalClaimableEarnings -= amount;
        _sendValue(msg.sender, amount);
        emit EarningsWithdrawn(msg.sender, amount);
    }

    function withdrawRefund() external nonReentrant {
        uint256 amount = claimableRefunds[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        claimableRefunds[msg.sender] = 0;
        totalClaimableRefunds -= amount;
        _sendValue(msg.sender, amount);
        emit RefundWithdrawn(msg.sender, amount);
    }

    function getRoom(uint256 roomId) external view returns (DataRoom memory) {
        DataRoom memory room = _rooms[roomId];
        if (room.issuer == address(0)) revert InvalidRoom();
        return room;
    }

    function getReview(uint256 reviewId) external view returns (AIReview memory) {
        AIReview memory review = _reviews[reviewId];
        if (review.reviewer == address(0)) revert InvalidReview();
        return review;
    }

    function getAccessRequest(uint256 requestId) external view returns (AccessRequest memory) {
        AccessRequest memory request = _requests[requestId];
        if (request.investor == address(0)) revert InvalidRequest();
        return request;
    }

    function getVerifierAttestation(uint256 attestationId) external view returns (VerifierRecord memory) {
        VerifierRecord memory record = _verifierRecords[attestationId];
        if (record.verifier == address(0)) revert InvalidAttestation();
        return record;
    }

    function isRoomReviewReady(uint256 roomId) external view returns (bool) {
        DataRoom storage room = _rooms[roomId];
        if (room.issuer == address(0)) return false;
        return _isCurrentReviewReady(room, _reviews[room.currentReviewId]);
    }

    function isRoomReviewAccepted(uint256 roomId) external view returns (bool) {
        DataRoom storage room = _rooms[roomId];
        if (room.issuer == address(0)) return false;
        return _isCurrentReviewAccepted(roomId, room, _reviews[room.currentReviewId]);
    }

    function accountedBalance() external view returns (uint256) {
        return totalPendingEscrow + totalClaimableEarnings + totalClaimableRefunds;
    }

    function hashReviewAttestation(AIReviewAttestation calldata attestation) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                AI_REVIEW_TYPEHASH,
                attestation.roomId,
                attestation.roomVersion,
                attestation.documentRoot,
                attestation.templateId,
                uint8(attestation.reviewStatus),
                attestation.riskFlagsHash,
                attestation.reportHash,
                attestation.policyVersion,
                attestation.nonce,
                attestation.expiry
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function hashVerifierAttestation(VerifierAttestation calldata attestation) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                VERIFIER_ATTESTATION_TYPEHASH,
                attestation.roomId,
                attestation.roomVersion,
                attestation.documentRoot,
                attestation.findingsHash,
                attestation.nonce,
                attestation.expiry
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function _isCurrentReviewReady(DataRoom storage room, AIReview storage review)
        internal
        view
        returns (bool)
    {
        return review.status == ReviewStatus.ReviewReady && _isCurrentReviewValid(room, review);
    }

    function _isCurrentReviewAccepted(uint256 roomId, DataRoom storage room, AIReview storage review)
        internal
        view
        returns (bool)
    {
        return _isCurrentReviewValid(room, review)
            && (review.status == ReviewStatus.ReviewReady
                || acknowledgedReviewId[roomId] == room.currentReviewId);
    }

    function _isCurrentReviewValid(DataRoom storage room, AIReview storage review)
        internal
        view
        returns (bool)
    {
        return room.currentReviewId != 0 && review.status != ReviewStatus.None
            && review.documentRoot == room.documentRoot && review.roomVersion == room.version
            && review.templateId == room.templateId && review.expiry > block.timestamp
            && supportedTemplates[review.templateId] && supportedPolicyVersions[review.policyVersion];
    }

    function _creditRefund(AccessRequest storage request) internal {
        totalPendingEscrow -= request.amount;
        totalClaimableRefunds += request.amount;
        claimableRefunds[request.investor] += request.amount;
    }

    /// @dev Resolves the current identity registry from the token on every
    ///      security decision so a registry update by the token owner is
    ///      honored immediately. Uses raw staticcalls so EOAs, reverting
    ///      contracts, and empty returns all fail closed.
    function _resolveIdentityRegistry(address token) internal view returns (address) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeCall(IERC3643TokenLike.identityRegistry, ()));
        if (!ok || ret.length != 32) revert InvalidRegulatedToken();
        address registry = abi.decode(ret, (address));
        if (registry == address(0)) revert InvalidRegulatedToken();
        return registry;
    }

    function _requireVerifiedInvestor(DataRoom storage room, address investor) internal view {
        if (room.regulatedToken == address(0)) return;
        (bool ok, bytes memory ret) = _resolveIdentityRegistry(room.regulatedToken)
            .staticcall(abi.encodeCall(IERC3643IdentityRegistryLike.isVerified, (investor)));
        if (!ok || ret.length != 32) revert InvestorNotVerified();
        if (!abi.decode(ret, (bool))) revert InvestorNotVerified();
    }

    function _sendValue(address recipient, uint256 amount) internal {
        (bool success,) = payable(recipient).call{ value: amount }("");
        if (!success) revert TransferFailed();
    }

    receive() external payable {
        revert InvalidPayment();
    }
}
