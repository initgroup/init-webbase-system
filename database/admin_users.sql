-- [ADMIN_USER_LIST]
SELECT USER_ID
     , LOGIN_ID
     , USER_NAME
     , EMAIL
     , ROLE_CODE
     , USE_YN
     , CREATED_AT
     , UPDATED_AT
  FROM (
        SELECT USER_ID
             , LOGIN_ID
             , USER_NAME
             , EMAIL
             , ROLE_CODE
             , USE_YN
             , CREATED_AT
             , UPDATED_AT
          FROM "INIT$_TB_USER"
         WHERE (
               :keyword IS NULL
               OR UPPER(LOGIN_ID) LIKE :keyword
               OR UPPER(USER_NAME) LIKE :keyword
               OR UPPER(EMAIL) LIKE :keyword
              )
           AND (:useYn = 'ALL' OR USE_YN = :useYn)
         ORDER BY CREATED_AT DESC
                , USER_ID DESC
       )
 WHERE ROWNUM <= :limit
;

-- [ADMIN_USER_UPDATE]
UPDATE "INIT$_TB_USER"
   SET ROLE_CODE = :roleCode
     , USE_YN = :useYn
     , UPDATED_AT = SYSTIMESTAMP
 WHERE USER_ID = :userId
;

-- [ADMIN_USER_TABLE_LOCK]
LOCK TABLE "INIT$_TB_USER" IN EXCLUSIVE MODE
;

-- [ADMIN_USER_ROLE_STATUS]
SELECT ROLE_CODE
     , USE_YN
  FROM "INIT$_TB_USER"
 WHERE USER_ID = :userId
;

-- [ADMIN_ACTIVE_ADMIN_COUNT]
SELECT COUNT(*)
  FROM "INIT$_TB_USER"
 WHERE ROLE_CODE = 'ADMIN'
   AND USE_YN = 'Y'
;

-- [ADMIN_USER_PASSWORD_RESET]
UPDATE "INIT$_TB_USER"
   SET PASSWORD_HASH = :passwordHash
     , UPDATED_AT = SYSTIMESTAMP
 WHERE USER_ID = :userId
;

-- [ADMIN_USER_SESSION_REVOKE]
UPDATE "INIT$_TB_AUTH_SESSION"
   SET REVOKED_AT = LOCALTIMESTAMP
 WHERE USER_ID = :userId
   AND REVOKED_AT IS NULL
;
